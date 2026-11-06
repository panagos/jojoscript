import { AsyncLocalStorage } from 'node:async_hooks'
import { getCurrentContext } from './execution-context.js'

/*
 * Algebraic effects / effect handlers runtime.
 *
 * The core idea: `defineEffect` turns a name into a callable that *describes
 * an intent* ("perform fetchUser(42)") without deciding how it is carried
 * out. `withHandlers` installs a handler map for the dynamic extent of a
 * callback (an async-local, stack-shaped scope, exactly like
 * `execution-context.js` already does for checkpoint/metrics state), and
 * `performEffect` resolves an effect call against the innermost matching
 * handler at the moment it is invoked.
 *
 * This is deliberately a *simplified* effect-handler model, not full
 * algebraic effects: there is no delimited-continuation `resume`, handlers
 * cannot resume a suspended computation more than once (or zero times) and
 * inspect the result, and effects cannot be "re-thrown" to an outer handler
 * after partial handling. What it *does* provide: named effects, dynamic
 * handler dispatch, handler nesting/overriding, deterministic-vs-real
 * handler swapping, and a clean async/JS interop story (a handler is just
 * a normal — sync or async — JavaScript function).
 */

const handlerStorage = new AsyncLocalStorage()
const invocationStorage = new AsyncLocalStorage()
const authorizationStorage = new AsyncLocalStorage()
const deterministicStorage = new AsyncLocalStorage()

/*
 * name -> { name, params, sideEffecting, replayable, builtin? }.
 * Populated by every `defineEffect` call (i.e. every `effect name(...)`
 * declaration compiles into one), plus the built-in `PARALLEL` capability.
 * Purely descriptive metadata for inspection — never consulted by
 * dispatch itself.
 */
const effectRegistry = new Map()

export class UnhandledEffectError extends Error {
  constructor(name) {
    super(`Unhandled effect: ${name}\nNo handler registered for effect "${name}"`)
    this.name = 'UnhandledEffectError'
    this.effectName = name
  }
}

export class EffectHandlerError extends Error {
  constructor(name, cause) {
    super(`Effect handler for "${name}" threw: ${cause?.message ?? cause}`, { cause })
    this.name = 'EffectHandlerError'
    this.effectName = name
  }
}

export class RecursiveEffectError extends Error {
  constructor(name) {
    super(`Effect handler for "${name}" recursively invoked the same effect ("${name}")`)
    this.name = 'RecursiveEffectError'
    this.effectName = name
  }
}

export class EffectAuthorizationError extends Error {
  constructor(name, reason, options = {}) {
    const prefix = options.failed ? 'Effect authorization failed' : 'Effect authorization denied'
    super(`${prefix} for "${name}": ${reason}`, { cause: options.cause })
    this.name = 'EffectAuthorizationError'
    this.effectName = name
    this.reason = reason
    this.retryable = false
  }
}

export class NondeterministicEffectError extends Error {
  constructor(name) {
    super(`Effect "${name}" has no deterministic handler; inside deterministic mode use { handle, deterministic: true } or replayHandlers`)
    this.name = 'NondeterministicEffectError'
    this.effectName = name
    this.retryable = false
  }
}

/*
 * Declares a named effect and returns the callable used to *perform* it.
 * `options.sideEffecting` (default true) and `options.replayable` (default
 * false) are pure metadata consumed by inspection (`describeEffect`,
 * `describeHandlers`) and by callers deciding whether it's safe to treat a
 * result as reusable across a checkpoint/replay boundary — the runtime
 * itself never enforces them.
 */
export function defineEffect(name, params = [], options = {}) {
  effectRegistry.set(name, {
    name,
    params: [...params],
    sideEffecting: options.sideEffecting ?? true,
    replayable: options.replayable ?? false
  })

  function effectFn(...args) {
    return performEffect(name, args)
  }

  effectFn.effectName = name
  effectFn.isEffect = true
  return effectFn
}

export function describeEffect(name) {
  return effectRegistry.get(name) ?? null
}

export function listEffects() {
  return [...effectRegistry.values()]
}

function normalizeHandlerEntry(name, value) {
  if (typeof value === 'function') {
    return { handle: value, deterministic: undefined }
  }

  if (value && typeof value === 'object' && typeof value.handle === 'function') {
    return { handle: value.handle, deterministic: value.deterministic ?? undefined }
  }

  throw new TypeError(
    `Invalid handler for effect "${name}": expected a function, e.g. \`id => fakeUser(id)\`, ` +
    'or a `{ handle, deterministic }` descriptor'
  )
}

function currentFrames() {
  return handlerStorage.getStore() ?? []
}

function currentAuthorizationPolicies() {
  return authorizationStorage.getStore() ?? []
}

/*
 * Installs `handlers` (an object of `name -> handlerFn | { handle,
 * deterministic }`) for the dynamic extent of `fn`, then restores whatever
 * was active before. Nesting `withHandlers` calls (source: nested `handle`
 * blocks) pushes a new innermost frame in front of the existing ones, so an
 * inner handler for the same effect name shadows — overrides — an outer
 * one, while effects the inner handler map does *not* mention still fall
 * through to the outer handler.
 *
 * Caveat (shared with `execution-context.js`'s checkpoint/metrics context):
 * because pipeline stages like `map`/`filter` are lazy generators, the
 * handler frame is only active while `fn` is *synchronously/async-chain*
 * executing. If `fn` merely constructs a lazy pipeline and returns it
 * without consuming it (no `toArray`/`toArrayAsync`/`reduce`/...), items
 * pulled later outside this call will see whatever handlers (if any) are
 * active at that later point, not these ones. Always consume (or `await`)
 * effectful pipelines inside the `handle { ... } { ... }` block itself.
 */
export function withHandlers(handlers, fn) {
  if (!handlers || typeof handlers !== 'object') {
    throw new TypeError('withHandlers requires a handler map object, e.g. { effectName: handlerFn }')
  }

  const normalized = {}
  for (const [name, value] of Object.entries(handlers)) {
    normalized[name] = normalizeHandlerEntry(name, value)
  }

  const frames = [{ handlers: normalized }, ...currentFrames()]
  return handlerStorage.run(frames, fn)
}

/*
 * Installs a capability policy for the dynamic extent of `fn`. Nested
 * policies compose restrictively: every active policy must explicitly allow
 * an invocation, so an inner handler or policy cannot bypass an outer
 * boundary.
 */
export function withAuthorization(policy, fn) {
  if (typeof policy !== 'function') {
    throw new TypeError('withAuthorization requires an authorization function')
  }

  return authorizationStorage.run([...currentAuthorizationPolicies(), policy], fn)
}

async function authorizeEffect(name, args) {
  const policies = currentAuthorizationPolicies()
  if (policies.length === 0) return

  const invocation = {
    name,
    args: [...args],
    effect: effectRegistry.get(name) ?? null,
    context: getCurrentContext() ?? null
  }

  for (const policy of policies) {
    let decision
    try {
      decision = await policy(invocation)
    } catch (error) {
      throw new EffectAuthorizationError(name, `authorization callback failed: ${error?.message ?? error}`, {
        failed: true,
        cause: error
      })
    }

    if (decision === true || decision?.allowed === true) continue

    const reason = typeof decision?.reason === 'string'
      ? decision.reason
      : 'policy did not explicitly allow this invocation'
    throw new EffectAuthorizationError(name, reason)
  }
}

/*
 * Resolves and invokes the effect named `name` against the innermost
 * handler that declares it. Always returns a Promise (even for a
 * synchronous handler) so calling code never needs to know whether the
 * active handler is sync or async — production (often async: HTTP/DB) and
 * test (often sync: fake data) handlers are interchangeable.
 */
export async function performEffect(name, args) {
  const inFlight = invocationStorage.getStore() ?? new Set()
  if (inFlight.has(name)) {
    throw new RecursiveEffectError(name)
  }

  const frame = currentFrames().find(f => name in f.handlers)
  if (!frame) {
    throw new UnhandledEffectError(name)
  }

  const entry = frame.handlers[name]
  if (deterministicStorage.getStore() && entry.deterministic !== true) {
    throw new NondeterministicEffectError(name)
  }

  await authorizeEffect(name, args)

  const nextInFlight = new Set(inFlight)
  nextInFlight.add(name)

  try {
    return await invocationStorage.run(nextInFlight, () => entry.handle(...args))
  } catch (error) {
    if (error instanceof RecursiveEffectError || error instanceof UnhandledEffectError) throw error
    throw new EffectHandlerError(name, error)
  }
}

/*
 * Introspection: which effects have an active handler *right now* (i.e.
 * called from inside a `handle { ... } { ... }` block), and what is known
 * about each — handled, whether the installed handler declared itself
 * deterministic, and the declaring effect's `sideEffecting`/`replayable`
 * metadata. Returns `[]` outside any `withHandlers` scope.
 */
export function describeHandlers() {
  const seen = new Map()

  for (const frame of currentFrames()) {
    for (const [name, entry] of Object.entries(frame.handlers)) {
      if (seen.has(name)) continue

      const registryEntry = effectRegistry.get(name)
      seen.set(name, {
        name,
        handled: true,
        deterministic: entry.deterministic ?? null,
        sideEffecting: registryEntry?.sideEffecting ?? null,
        replayable: registryEntry?.replayable ?? null
      })
    }
  }

  return [...seen.values()]
}

/*
 * `parallel(n)` as an effect-backed capability (see collections.js' `map`):
 * if a `PARALLEL` handler is currently installed, it decides how
 * `items |> parallel(n) |> map(fn)` actually runs (real concurrency,
 * deterministic sequential execution, recorded scheduling, ...). With no
 * handler installed, `map` falls back to the original bounded-concurrency
 * implementation — existing programs that never touch `handle {}` are
 * completely unaffected.
 */
effectRegistry.set('PARALLEL', {
  name: 'PARALLEL',
  params: ['concurrency'],
  sideEffecting: true,
  replayable: false,
  builtin: true
})

for (const [name, params] of [['TIME', []], ['RANDOM', []]]) {
  effectRegistry.set(name, { name, params, sideEffecting: false, replayable: false, builtin: true })
}

function builtinHandler(name) {
  const frame = currentFrames().find(f => name in f.handlers)
  return frame ? frame.handlers[name].handle : null
}

export function getParallelHandler() {
  return builtinHandler('PARALLEL')
}

/*
 * `now()` and `random()` are built-in capabilities like `PARALLEL`: they are
 * synchronous, fall back to `Date.now()` / `Math.random()`, and can be
 * replaced with `handle { TIME: ..., RANDOM: ... }` or `deterministic()`.
 */
export function now() {
  const handler = builtinHandler('TIME')
  return handler ? handler() : Date.now()
}

export function random() {
  const handler = builtinHandler('RANDOM')
  return handler ? handler() : Math.random()
}

// mulberry32: a small, well-distributed seeded generator.
function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function* runSequentially({ items, fn }) {
  for await (const item of items) yield await fn(item)
}

/*
 * Runs `fn` so that the same inputs always produce the same outputs: a seeded
 * `random()`, a clock that starts at `startTime` and advances 1ms per read,
 * sequential `parallel()`, and only effects whose handler is declared
 * deterministic (including replay handlers).
 */
export function deterministic(fn, options = {}) {
  let clock = options.startTime ?? 0
  const handlers = {
    TIME: { handle: () => clock++, deterministic: true },
    RANDOM: { handle: seededRandom(options.seed ?? 1), deterministic: true },
    PARALLEL: { handle: runSequentially, deterministic: true }
  }

  return deterministicStorage.run(true, () => withHandlers(handlers, fn))
}

/*
 * Record/replay extension point (see effect-log.js for the storage side).
 * `recordHandlers` wraps a normal (typically production) handler map so
 * every call's arguments and result are appended to `log`; `replayHandlers`
 * builds a handler map that never runs real code at all, just replays
 * recorded results for the given effect names, in call order, per effect.
 */
export function recordHandlers(handlers, log) {
  const wrapped = {}

  for (const [name, value] of Object.entries(handlers)) {
    const entry = normalizeHandlerEntry(name, value)
    wrapped[name] = {
      deterministic: entry.deterministic,
      handle: async (...args) => {
        const result = await entry.handle(...args)
        await log.record({ name, args, result, recordedAt: new Date().toISOString() })
        return result
      }
    }
  }

  return wrapped
}

export function replayHandlers(effectNames, log) {
  const wrapped = {}

  for (const name of effectNames) {
    wrapped[name] = {
      deterministic: true,
      handle: async () => {
        const call = await log.replayNext(name)
        return call.result
      }
    }
  }

  return wrapped
}
