# JojoScript 0.10.0

JojoScript is a small JavaScript-compatible language and runtime for
expressive, composable pipelines. It adds lightweight syntax for declarations,
functions, pattern matching, type annotations, and pipelines while preserving
ordinary JavaScript. Its compiler uses a lightweight lexer and source
transformations rather than a full AST, keeping the toolchain compact. The
project also provides lazy and async collection operators, checkpointing,
retries, metrics, pipeline graphing, CLI workflows, effect handlers, MCP and
A2A support, and VS Code editor support.

See [CHANGELOG.md](CHANGELOG.md) for release history and
[example/](example/) for a complete runnable application that exercises
every feature described below.

## Install

```bash
npm install @panagos/jojoscript
```

## CLI

```bash
jojo build <file.jojo|directory> [--out <directory>] [--watch]
jojo run <file.jojo> [--out <directory>]
jojo graph <file.jojo> [--format text|dot]
jojo profile <file.jojo>
jojo resume <file.jojo> [--out <directory>]
jojo replay <file.jojo> --from <checkpoint> [--out <directory>]
jojo test <file.jojo>
jojo --version
jojo --help
```

- `jojo build src` compiles every `.jojo` file under `src` to `src/dist/*.js` (or `--out <dir>`).
- `jojo build src --watch` rebuilds whenever a `.jojo` file under `src` changes.
- `jojo run app.jojo` compiles a single file and immediately runs it with Node — useful for a fast dev loop.
- `jojo graph app.jojo` prints a static pipeline graph; use `--format dot` for Graphviz output.
- `jojo profile app.jojo` executes a pipeline and prints per-node item counts, duration, and throughput.
- `jojo resume app.jojo` reuses completed file-backed checkpoints; `jojo replay app.jojo --from name` starts from a selected checkpoint.
- `jojo test app.jojo` compiles the file and runs its co-located `<name>.test.js` test when present.
- Compiler and filesystem errors are reported as a single friendly line (`jojo: <message>`, exit code 1) instead of a raw stack trace. Unknown flags are rejected.

## Language features

### Immutable declaration

```jojo
users := getUsers()
```

becomes:

```js
const users = getUsers()
```

### Mutable declaration

```jojo
mutable count := 0
count++
```

becomes:

```js
let count = 0
count++
```

Existing JavaScript `const`, `let`, and `var` declarations are untouched.

### Destructuring declarations

Object and array patterns are supported with `:=` and `mutable :=`. Only the
declaration head is rewritten — the right-hand side is left completely
untouched and may span multiple lines.

```jojo
{ id, name } := getUser()
[head, ...rest] := items
mutable { count } := state
```

becomes:

```js
const { id, name } = getUser()
const [head, ...rest] = items
let { count } = state
```

### Multi-binding (tuple) declarations

A comma-separated list of names before `:=` destructures a comma-separated
list of values on the right-hand side (single line only):

```jojo
a, b := 1, 2
mutable x, y := 10, 20
```

becomes:

```js
const [a, b] = [1, 2]
let [x, y] = [10, 20]
```

This is a distinct construct from bracket destructuring: use `a, b := 1, 2`
to bind a fixed list of values, and `[a, b] := getPair()` to destructure a
single array-producing expression.

### Functions

Block functions:

```jojo
fn add(a, b) {
  return a + b
}
```

Expression functions:

```jojo
fn double(value) = value * 2
```

Async functions:

```jojo
async fn loadUsers() {
  return await getUsers()
}
```

### Optional type annotations

Parameters and return values can be annotated. Annotations are **never
checked** — they are stripped from the emitted JavaScript and re-expressed
as a JSDoc block above the function, so editors/tools that understand JSDoc
get parameter and return type information without JojoScript needing its own
type checker.

```jojo
fn add(a: number, b: number): number { return a + b }
```

becomes:

```js
/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function add(a, b) { return a + b; }
```

Functions with no annotations are left completely untouched.

### `match` expression

`match` compares a subject against each pattern with `===`, in order, and
requires a default `_` arm as the last arm. Arms are single expressions
(not statement blocks).

```jojo
label := match status {
  200 => "OK",
  404 => "Not Found",
  _ => "Unknown"
}
```

becomes:

```js
const label = (() => {
  const __match = status;
  if (__match === (200)) return "OK";
  if (__match === (404)) return "Not Found";
  return "Unknown";
})()
```

Patterns can be arbitrary expressions, which enables range-style matching
against `true`:

```jojo
category := match true {
  value > 100 => "large",
  value > 10 => "medium",
  _ => "small"
}
```

`match` is a value-equality construct, not structural pattern matching:
patterns are plain expressions compared with `===`.

### Pipelines

```jojo
users
  |> filter(isAdult)
  |> map(normalize)
  |> sort(byName)
  |> take(10)
```

becomes nested JavaScript calls:

```js
take(sort(map(filter(users, isAdult), normalize), byName), 10)
```

A stage can have no arguments (`users |> unique`) or arguments
(`users |> take(10)`), and normal JavaScript expressions can be pipeline
inputs, including `await` expressions and pipelines inside `return`
statements, function bodies, and object literals.

#### Placeholder argument

By default the piped value is inserted as the stage's first argument. The
`_` placeholder lets you put it anywhere in the argument list instead:

```jojo
value |> divide(100, _)
```

becomes:

```js
divide(100, value)
```

#### Property access stages

A pipeline stage may also start with a dot to read a field or invoke a method
on the piped value directly:

```jojo
users |> .length
name |> .trim() |> .toUpperCase()
```

becomes:

```js
users.length
name.trim().toUpperCase()
```

This is handy for compact pipelines where the previous value is the receiver of
an ordinary JavaScript property or method call.

#### `catch` / `orElse` control stages

`catch` and `orElse` provide inline error handling without leaving pipeline
syntax. Both wrap the preceding pipeline in a try/catch, compiled as an
immediately-invoked arrow function:

```jojo
risky() |> catch(error => fallbackFor(error))
risky() |> orElse(0)
```

`catch(handler)` calls `handler(error)` and returns its result; `orElse(fallback)`
returns `fallback` directly. Both require exactly one argument.

#### `await` control stage

`|> await` unwraps a promise at the end of a pipeline, so an async pipeline
still reads as a single chain:

```jojo
return ids
  |> mapAsync(id => repository.findById(id))
  |> toArrayAsync
  |> await
```

`await`, `catch`, and `orElse` are resolved at compile time and are never
added to the automatic `@panagos/jojoscript/runtime` import.

### Standard pipeline runtime

The following pipeline stages are supplied by `@panagos/jojoscript/runtime`. The
compiler automatically generates only the runtime imports that are actually
used through pipeline syntax (custom/user-defined stages are never
auto-imported):

| Stage | Kind | Description |
|---|---|---|
| `map` | lazy | Transform each item |
| `filter` | lazy | Keep items matching a predicate |
| `take` | lazy | Keep the first N items |
| `skip` | lazy | Discard the first N items |
| `unique` | lazy | Remove duplicates (by `===`) |
| `flatMap` | lazy | Map then flatten one level |
| `distinctBy` | lazy | Remove duplicates by a derived key |
| `tap` | lazy | Observe each item without changing the pipeline (side effects/debugging) |
| `chunk` | lazy | Group items into fixed-size arrays |
| `window` | lazy | Yield a sliding view of size N |
| `zip` | lazy | Pair items from two iterables, stopping at the shorter one |
| `zipWith` | lazy | Combine items from two iterables with an arity-2 combining function, stopping at the shorter one |
| `scan` | lazy | Yield a running accumulation (like `reduce`, but yields every step) |
| `mapAsync` | lazy, async | Like `map`, awaiting an async transform |
| `filterAsync` | lazy, async | Like `filter`, awaiting an async predicate |
| `sort` | eager | Materializes the input; sorting needs the complete input |
| `sortBy` | eager | Like `sort`, ordered by a derived key |
| `groupBy` | eager | Groups items into a `Map` keyed by a derived key |
| `partition` | eager | Splits into `[matching, nonMatching]` arrays |
| `reduce` | terminal | Accumulate to a single value |
| `toArray` | terminal | Materialize an iterator into an array |
| `toArrayAsync` | terminal, async | Materialize an async iterator into an array |
| `count` | terminal | Count items |
| `first` | terminal | First item, or `undefined` |
| `find` | terminal | First matching item, or `undefined` |
| `some` | terminal | Whether any item matches (short-circuits) |
| `every` | terminal | Whether every item matches (short-circuits) |

See [ITERATOR_PROPOSAL.md](ITERATOR_PROPOSAL.md) and [ITERATORS.md](ITERATORS.md)
for the full laziness/memory model.

## Effect Handlers

> This is a deliberately simplified effect-handler model, not full
> algebraic effects with delimited continuations (no `resume`, no
> resuming a suspended computation zero/more-than-once, no re-throwing to
> an outer handler after partial handling). What it *does* give you: named
> effects, dynamic handler dispatch, nesting/overriding, deterministic
> mock handlers, record/replay, and a `parallel()` effect — all with plain
> JavaScript interop. If you already know algebraic effects from OCaml/Eff/
> Koka, think "a practical subset", not "the whole theory".

The central idea:

```
Pipeline
  describes computation

Execution Plan
  describes how the computation can be executed

Effect
  describes an external capability/action

Effect Handler
  decides how that capability/action is interpreted
```

**Describe the computation once, choose its interpretation separately.**

### What an effect is

`effect name(params)` declares a named capability — "this program wants to
fetch a user", not "this program makes an HTTP GET request". It compiles to
a plain runtime call:

```jojo
effect fetchUser(id)
effect saveUser(user)
```

becomes:

```js
const fetchUser = defineEffect("fetchUser", ["id"])
const saveUser = defineEffect("saveUser", ["user"])
```

Calling `fetchUser(id)` doesn't run anything itself — it looks up the
currently active handler for `"fetchUser"` and delegates to it. **Calling an
effect always returns a Promise**, even if the active handler is
synchronous, so the calling code never has to know or care whether the
handler in charge is a real (often async) implementation or a fake (often
sync) one.

### What an effect handler is, and how to install one

A handler supplies the implementation for one or more named effects, for
the dynamic extent of a block:

```jojo
effect fetchUser(id)
effect saveUser(user)

users
  |> map(user => fetchUser(user.id))
  |> map(saveUser)
```

runs under:

```jojo
handle {
  fetchUser: id => http.get(`/users/${id}`),
  saveUser: user => database.save(user)
} {
  users
    |> map(user => fetchUser(user.id))
    |> map(saveUser)
}
```

which compiles to:

```js
(await withHandlers({
  fetchUser: id => http.get(`/users/${id}`),
  saveUser: user => database.save(user)
}, async () => {
  users
    |> map(user => fetchUser(user.id))
    |> map(saveUser)
}))
```

A handler value can be a plain function, or a `{ handle, deterministic }`
descriptor when you want to declare it explicitly deterministic (useful for
inspection — see below):

```jojo
handle {
  fetchUser: { handle: id => fakeUser(id), deterministic: true }
} {
  ...
}
```

Because `handle { ... } { ... }` compiles to `await withHandlers(...)`, it
must be used inside an `async fn`/`async function`, or at the top level of
an ES module (Node's top-level `await`) — the same requirement the existing
`|> await` pipeline stage already has.

### How the same program runs under different handlers

The program never mentions which handler is active — only the caller
decides that, by choosing which `handle { ... }` wraps it:

```jojo
effect fetchUser(id)
effect saveUser(user)

async fn syncUser(id) {
  user := await fetchUser(id)
  return await saveUser(user)
}

async fn syncUserInProduction(id) {
  return handle {
    fetchUser: id => http.get(`/users/${id}`),
    saveUser: user => database.save(user)
  } {
    return await syncUser(id)
  }
}

async fn syncUserInTests(id) {
  return handle {
    fetchUser: id => ({ id, name: "Fake User" }),
    saveUser: user => ({ ...user, savedTo: "in-memory" })
  } {
    return await syncUser(id)
  }
}
```

`syncUser` is identical in both cases; only the handler map differs. See
[example/src/effects/multiple-handlers.jojo](example/src/effects/multiple-handlers.jojo)
and
[example/src/effects/deterministic-testing.jojo](example/src/effects/deterministic-testing.jojo).

### Nested handlers and resolution rules

`handle` blocks nest. An inner handler for a given effect name **overrides**
an outer one; an inner handler map that doesn't mention an effect leaves it
falling through to the next outer handler that does:

```jojo
handle {
  fetchUser: outerFake
} {
  handle {
    fetchUser: innerFake
  } {
    users |> map(fetchUser) // resolves to innerFake
  }

  users |> map(fetchUser) // resolves to outerFake, outside the inner block
}
```

Resolution walks from the innermost active `handle` block outward, taking
the first one that declares the effect. Once a `handle` block's body
finishes, its handlers are gone — code that runs afterwards (or a lazy
pipeline consumed afterwards, see the caveat below) no longer sees them.

### Error handling

| Situation | Result |
|---|---|
| Effect invoked with no active handler for it | `UnhandledEffectError`: `` Unhandled effect: fetchUser\nNo handler registered for effect "fetchUser" `` |
| Handler throws (or its returned Promise rejects) | `EffectHandlerError`, naming the effect and wrapping the original error as `.cause` |
| Handler value isn't a function or `{ handle, deterministic }` | `TypeError`, thrown immediately when `handle { ... }` installs it, not at call time |
| A handler recursively invokes the same effect (directly, or indirectly through another effect) | `RecursiveEffectError`, naming the effect |
| Effect invoked entirely outside any `handle` block | Same as "no active handler" — `UnhandledEffectError` |

### `parallel()` as an effect

`items |> parallel(n) |> map(fn)` is effect-backed. With no handler
installed, it behaves exactly as before (a bounded-concurrency worker
pool — existing programs are unaffected). Installing a `PARALLEL` handler
lets a different interpretation take over completely:

```jojo
handle {
  PARALLEL: async ({ items, fn, concurrency }) => {
    // deterministic, strictly sequential — great for tests
    results := []
    for await (const item of items) results.push(await fn(item))
    return results
  }
} {
  numbers |> parallel(8) |> map(process) |> toArrayAsync |> await
}
```

A `PARALLEL` handler receives `{ items, fn, concurrency, meta }` and returns
an (async) iterable of results in order — the same contract the built-in
implementation follows. This lets production code use real concurrency,
tests force deterministic sequential execution, and a debugging handler
record scheduling information, all without changing the pipeline. See
[example/src/effects/parallel-effect.jojo](example/src/effects/parallel-effect.jojo).

### Effects in the execution plan

`jojo graph`/`analyzePipelines` expose which pipeline nodes reference which
declared effects, and a best-effort static "is a handler for it declared
anywhere in this file?" signal:

```jojo
effect fetchUser(id)
effect saveUser(user)

handle {
  fetchUser: id => ({ id })
} {
  users
    |> map(user => fetchUser(user.id))
    |> parallel(8)
    |> map(saveUser)
}
```

```
SOURCE users
      │
      ▼
MAP user => fetchUser(user.id)  [effects: fetchUser]
      │
      ▼
PARALLEL 8
      │
      ▼
MAP saveUser  [effects: saveUser]
      │
      ▼
RESULT
```

Programmatically, `analyzePipelines(source)` returns each pipeline's graph
with an `effects` array:

```js
[
  { name: "fetchUser", nodeId: "node-1", staticallyHandled: true },
  { name: "saveUser", nodeId: "node-3", staticallyHandled: false }
]
```

`staticallyHandled` is a textual, best-effort signal (a `handle { name: ... }`
naming that effect was found somewhere in the file) — it cannot see handlers
installed conditionally or dynamically at runtime. For that, call
`describeHandlers()` from inside a running `handle { ... }` block: it
reports, per currently-handled effect, whether the installed handler
declared itself `deterministic`, and the declaring effect's `sideEffecting`/
`replayable` metadata (from `effect name(params)`'s options, or defaults —
`sideEffecting: true`, `replayable: false`).

### Effects and checkpoint/resume

Consider:

```jojo
effect fetchUser(id)

ids
  |> mapAsync(fetchUser)
  |> checkpoint("users-fetched")
  |> toArrayAsync
```

`checkpoint(name)` either streams items through once and durably saves them
all, or — if a checkpoint for `name` already completed — returns the saved
items **without ever touching the upstream iterable at all**. This gives
effects placed before a checkpoint a specific, non-magical guarantee:

- **Once a checkpoint has completed**, a later run does **not** re-invoke
  the upstream effect(s) — the saved items are restored instead. This is
  restoration from checkpoint state, not effect replay: the checkpoint
  store never sees the individual `fetchUser` calls, only the pipeline
  items that came out the other side.
- **If a checkpoint never completed** (crash, first run, ...), the upstream
  effect(s) run again from scratch on the next attempt — there is no
  per-item resume within an incomplete checkpoint.

**This is explicitly not exactly-once effect execution.** It is
"at-least-once until the checkpoint fully completes, then exactly zero
additional times after." A non-idempotent, non-replayable effect
(`replayable: false`, the default) must tolerate being invoked again on a
crash-and-retry before its checkpoint completes. Mark an effect
`{ replayable: true }` only if calling it again with the same arguments is
actually safe. See
[example/src/effects/checkpoint-resume.jojo](example/src/effects/checkpoint-resume.jojo)
and `test/effects-checkpoint.test.js` for both cases exercised end to end.

### Record/replay

A handler map can be wrapped to record every call (arguments + result) to
an `EffectLog`, and later replayed from that log without running any real
code:

```js
import { recordHandlers, replayHandlers, withHandlers } from "@panagos/jojoscript/runtime"
import { FileEffectLog } from "@panagos/jojoscript/runtime"

const log = new FileEffectLog("./fetchUser.log.json")

// Recording run: calls the real handler, and appends each call to the log.
await withHandlers(recordHandlers({ fetchUser: realFetchUser }, log), program)

// Replay run: never calls realFetchUser again, just replays recorded results.
await withHandlers(replayHandlers(["fetchUser"], log), program)
```

`EffectLog` (`MemoryEffectLog`/`FileEffectLog`) is a small, storage-agnostic
interface (`record`/`replayNext`), mirroring `CheckpointStore` — an
extension point for a future backend, not a full production-grade
persistence system.

### JavaScript interoperability

A handler is just a normal JavaScript function — sync or async — and can
call anything JavaScript can call:

```jojo
effect fetchUser(id)

handle {
  fetchUser: id => fetch(`/users/${id}`)
} {
  ...
}
```

### Guarantees and limitations

- Handler dispatch is dynamic-scope-based (an `AsyncLocalStorage` stack),
  the same mechanism `checkpoint`/`inspect`/metrics already use for
  execution context. Because pipeline stages are lazy, a `handle { ... }`
  block's handlers are only active while its body is *consumed* (e.g. via
  `toArray`/`toArrayAsync`/`reduce`/...), not merely constructed — always
  consume (or `await`) an effectful pipeline inside the `handle` block
  itself.
- No delimited continuations: a handler cannot `resume` the computation
  that invoked the effect, inspect intermediate state, or resume it more
  than once.
- Recursion guard: a handler invoking the same effect it is currently
  handling (directly or through another effect) is rejected with
  `RecursiveEffectError` rather than hanging or overflowing the stack.
- Existing programs that never use `effect`/`handle` syntax, and existing
  `parallel()` usage with no `PARALLEL` handler installed, are completely
  unaffected — this is additive, opt-in syntax.



JojoScript intentionally leaves ordinary JavaScript alone. You can use:

- normal `const`, `let`, and `var`
- arrow functions
- classes
- destructuring (as plain JS assignment, not a `:=` declaration)
- spread/rest
- optional chaining
- nullish coalescing
- template literals
- loops
- try/catch
- array methods
- async/await
- built-in Node modules
- npm/bare imports

Local relative imports receive `.js` after compilation:

```jojo
import { users } from "./users"
```

becomes:

```js
import { users } from "./users.js"
```

Bare imports remain untouched:

```jojo
import axios from "axios"
```

## Runtime package

Generated JavaScript imports the runtime using the package subpath:

```js
import { map, take } from "@panagos/jojoscript/runtime"
```

The package exposes this through `package.json` `exports`, so consumers
install `jojoscript` as a normal dependency. If a file both manually imports
from `@panagos/jojoscript/runtime` (for a stage that's only ever called directly,
never through `|>`) and also uses pipeline syntax with overlapping names,
the compiler merges the auto-imported names into the existing import
instead of emitting a second, colliding import declaration.

### MCP support

JojoScript includes a small MCP-style JSON-RPC runtime for Node.js. It does
not add MCP-specific language syntax; tool implementations remain ordinary
JavaScript functions.

```js
import { createMcpServer, runMcpStdioServer } from "jojoscript/runtime"

const server = createMcpServer({
  tools: {
    echo: args => ({ content: [{ type: "text", text: args.value }] })
  }
})

await runMcpStdioServer(server)
```

The server accepts `tools/call` requests and returns JSON-RPC responses on
standard output. It is intentionally minimal: supporting tool registration,
request dispatch, structured errors, and the stdin/stdout transport without any
external NPM packages.

### A2A client

JojoScript provides a dependency-free A2A 1.0 JSON-RPC client. It discovers a
remote agent through `/.well-known/agent-card.json`, selects its advertised
JSON-RPC interface, sends messages, and retrieves/polls task results.

```js
import { createA2AClient } from "jojoscript/runtime"

const agent = createA2AClient("https://agent.example")
await agent.discover()

const task = await agent.sendMessage({
  role: "ROLE_USER",
  parts: [{ text: JSON.stringify({ record: { id: "item-1" } }) }]
})
const result = await agent.waitForTask(task.id)
```

`sendMessage` and `getTask` map to the A2A `SendMessage` and `GetTask`
operations. `waitForTask` polls until the task reaches a terminal or
interrupted state, with a five-minute default timeout. Pass an alternate
`fetch` function and headers in the client options when integrating with a
custom transport or authenticated agent.

## Example

See [example/](example/). It is a complete runnable project covering every
language feature above plus JavaScript compatibility: a Node/SQLite
application that fetches posts from a public API, stores them, and prints a
report, alongside one small focused module (and test) per feature. Every
module is imported and invoked from `example/src/main.jojo`, so both
`npm start` and `npm test` exercise the whole example.

[example/src/effects/](example/src/effects/) has six focused Effect Handlers
examples (each with a matching test under `example/test/`): basic effects,
running the same program with multiple handlers, deterministic testing,
`parallel()` as an effect, effect visibility in the execution plan, and the
checkpoint/resume interaction.

[example/src/application/a2a-enrichment.jojo](example/src/application/a2a-enrichment.jojo)
demonstrates enriching a record through A2A discovery, message dispatch, and
task polling against a local test agent.

```bash
cd example
npm install
npm run build
npm start
npm test
```

## Iterator pipelines

Collection pipeline stages are lazy by default. `map`, `filter`, `take`,
`skip`, `unique`, `flatMap`, `distinctBy`, `tap`, `chunk`, `window`, `zip`,
`zipWith`, `scan`, `mapAsync`, and `filterAsync` return iterators (or async iterators)
instead of allocating an intermediate array. Use `toArray`/`toArrayAsync`
when an array is actually required.

```jojo
const total = users
  |> filter(user => user.active)
  |> map(user => user.age)
  |> reduce((sum, age) => sum + age, 0)
```

`sort`, `sortBy`, `groupBy`, and `partition` are intentionally materialization
boundaries because they need the complete input. See
[ITERATORS.md](ITERATORS.md) for the complete proposal and memory model.

## Editor support

See [editors/vscode](editors/vscode) for a VS Code extension providing syntax
highlighting and a `Format Document` provider for `.jojo` files. It is not
published to the marketplace; package it with `vsce package` and install the
resulting `.vsix` locally.

## Known limitations

- **No source maps.** Stack traces from compiled `dist/*.js` point at the
  generated JavaScript, not the original `.jojo` source.
- **No `jojo fmt` CLI command.** Formatting is only available through the
  VS Code extension's `Format Document` command, not the `jojo` CLI.
- **No regex-literal awareness in the lexer.** A regex containing `{`, `}`,
  `(`, or `)` can confuse brace/paren-depth-sensitive transforms (pipelines,
  `match`, destructuring, type annotations). Prefer `new RegExp(...)` in code
  paths that also use these constructs on the same line, or keep such regexes
  simple.
- **Pipeline statement boundaries need a blank line (or a semicolon) between
  consecutive `:=` statements that each end in a bare pipeline stage**, e.g.:

  ```jojo
  a := x |> map(f)
  b := y |> map(g)   // may be parsed as a continuation of the line above
  ```

  Add a blank line (or a trailing `;`) between them.
- **`match` subject expressions should be simple** (a single identifier,
  member access, or a fully-parenthesized expression) and appear on the same
  statement as the `{ ... }` block.
- **Multi-binding declarations (`a, b := 1, 2`) are single-line only** and
  always wrap the right-hand side in `[...]`; use `[a, b] := expr()` to
  destructure a single expression instead.
- **Effect Handlers are a simplified model, not full algebraic effects.**
  No delimited continuations/`resume`; a handler cannot inspect or resume
  the suspended computation, or resume it more than once. See the
  "Effect Handlers" section for the full list of guarantees/limitations.
- **`handle { ... } { ... }` handlers are only active while their body is
  actually consumed.** Constructing a lazy pipeline inside a `handle` block
  without consuming it there (no `toArray`/`toArrayAsync`/`reduce`/...) means
  effects pulled later, outside the block, won't see its handlers.
- **Only `PARALLEL` is a built-in effect today.** The other capabilities
  mentioned as a long-term direction (`IO`, `HTTP`, `FILE`, `DATABASE`,
  `SLEEP`, `TIME`, `RANDOM`, `CHECKPOINT`) are not implemented — user-defined
  `effect` declarations cover the same need today.
