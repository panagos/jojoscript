import test from 'node:test'
import assert from 'node:assert/strict'

import {
  defineEffect,
  withHandlers,
  withAuthorization,
  describeEffect,
  describeHandlers,
  UnhandledEffectError,
  EffectHandlerError,
  RecursiveEffectError,
  EffectAuthorizationError,
  recordHandlers,
  replayHandlers
} from '../src/runtime/effects.js'
import { MemoryEffectLog } from '../src/runtime/effect-log.js'
import { retry } from '../src/runtime/retry.js'

test('invoking an effect with no active handler throws a descriptive UnhandledEffectError', async () => {
  const fetchUser = defineEffect('fetchUser__unhandled', ['id'])

  await assert.rejects(() => fetchUser(1), error => {
    assert.ok(error instanceof UnhandledEffectError)
    assert.equal(error.effectName, 'fetchUser__unhandled')
    assert.match(error.message, /^Unhandled effect: fetchUser__unhandled/)
    assert.match(error.message, /No handler registered for effect "fetchUser__unhandled"/)
    return true
  })
})

test('a handled effect calls its handler and returns the result', async () => {
  const fetchUser = defineEffect('fetchUser__handled', ['id'])

  const result = await withHandlers(
    { fetchUser__handled: id => ({ id, name: 'fake' }) },
    () => fetchUser(42)
  )

  assert.deepEqual(result, { id: 42, name: 'fake' })
})

test('an effect invocation always returns a Promise, even for a synchronous handler', async () => {
  const ping = defineEffect('ping__sync', [])

  const returned = await withHandlers({ ping__sync: () => 'pong' }, () => {
    const value = ping()
    assert.ok(value instanceof Promise)
    return value
  })

  assert.equal(returned, 'pong')
})

test('an async handler is awaited transparently', async () => {
  const fetchUser = defineEffect('fetchUser__async', ['id'])

  const result = await withHandlers(
    { fetchUser__async: async id => { await new Promise(resolve => setTimeout(resolve, 1)); return { id } } },
    () => fetchUser(7)
  )

  assert.deepEqual(result, { id: 7 })
})

test('multiple different effects can each have their own handler', async () => {
  const fetchUser = defineEffect('fetchUser__multi', ['id'])
  const saveUser = defineEffect('saveUser__multi', ['user'])
  const saved = []

  const result = await withHandlers(
    {
      fetchUser__multi: id => ({ id, name: `user-${id}` }),
      saveUser__multi: user => { saved.push(user); return true }
    },
    async () => {
      const user = await fetchUser(1)
      return saveUser(user)
    }
  )

  assert.equal(result, true)
  assert.deepEqual(saved, [{ id: 1, name: 'user-1' }])
})

test('the same program runs with different handlers and produces different results', async () => {
  const fetchUser = defineEffect('fetchUser__swap', ['id'])

  async function program() {
    return fetchUser(1)
  }

  const production = await withHandlers({ fetchUser__swap: id => ({ id, source: 'http' }) }, program)
  const test1 = await withHandlers({ fetchUser__swap: id => ({ id, source: 'fake' }) }, program)

  assert.equal(production.source, 'http')
  assert.equal(test1.source, 'fake')
})

test('an inner handle block overrides an outer handler for the same effect', async () => {
  const fetchUser = defineEffect('fetchUser__override', ['id'])

  const result = await withHandlers({ fetchUser__override: () => 'outer' }, () =>
    withHandlers({ fetchUser__override: () => 'inner' }, () => fetchUser(1))
  )

  assert.equal(result, 'inner')
})

test('an inner handle block falls through to the outer handler for effects it does not mention', async () => {
  const fetchUser = defineEffect('fetchUser__fallthrough', ['id'])
  const saveUser = defineEffect('saveUser__fallthrough', ['user'])

  const result = await withHandlers(
    { fetchUser__fallthrough: () => 'outer-fetch', saveUser__fallthrough: () => 'outer-save' },
    () => withHandlers(
      { fetchUser__fallthrough: () => 'inner-fetch' },
      async () => [await fetchUser(1), await saveUser({})]
    )
  )

  assert.deepEqual(result, ['inner-fetch', 'outer-save'])
})

test('after the handle block ends, the previous (or no) handler is restored', async () => {
  const fetchUser = defineEffect('fetchUser__restore', ['id'])

  await withHandlers({ fetchUser__restore: () => 'inner' }, () => fetchUser(1))

  await assert.rejects(() => fetchUser(1), UnhandledEffectError)
})

test('a handler that throws is wrapped in an EffectHandlerError identifying the effect', async () => {
  const fetchUser = defineEffect('fetchUser__throws', ['id'])

  await assert.rejects(
    () => withHandlers({ fetchUser__throws: () => { throw new Error('boom') } }, () => fetchUser(1)),
    error => {
      assert.ok(error instanceof EffectHandlerError)
      assert.equal(error.effectName, 'fetchUser__throws')
      assert.match(error.message, /fetchUser__throws/)
      assert.match(error.message, /boom/)
      assert.equal(error.cause.message, 'boom')
      return true
    }
  )
})

test('a handler that rejects is also wrapped in an EffectHandlerError', async () => {
  const fetchUser = defineEffect('fetchUser__rejects', ['id'])

  await assert.rejects(
    () => withHandlers({ fetchUser__rejects: async () => { throw new Error('async boom') } }, () => fetchUser(1)),
    EffectHandlerError
  )
})

test('registering a non-function, non-descriptor handler throws immediately', () => {
  assert.throws(
    () => withHandlers({ fetchUser: 'not-a-function' }, () => {}),
    TypeError
  )
})

test('a handler recursively invoking the same effect throws RecursiveEffectError', async () => {
  const loop = defineEffect('loop__recursive', [])

  await assert.rejects(
    () => withHandlers({ loop__recursive: () => loop() }, () => loop()),
    error => {
      assert.ok(error instanceof RecursiveEffectError)
      assert.equal(error.effectName, 'loop__recursive')
      return true
    }
  )
})

test('indirect (mutual) recursion across two effects is also caught', async () => {
  const a = defineEffect('mutual__a', [])
  const b = defineEffect('mutual__b', [])

  await assert.rejects(
    () => withHandlers({ mutual__a: () => b(), mutual__b: () => a() }, () => a()),
    RecursiveEffectError
  )
})

test('calling the same effect twice sequentially (not recursively) is fine', async () => {
  const fetchUser = defineEffect('fetchUser__sequential', ['id'])
  let calls = 0

  const results = await withHandlers(
    { fetchUser__sequential: id => { calls++; return id } },
    async () => [await fetchUser(1), await fetchUser(2)]
  )

  assert.deepEqual(results, [1, 2])
  assert.equal(calls, 2)
})

test('describeEffect reports declared metadata, defaulting sideEffecting true and replayable false', () => {
  defineEffect('fetchUser__meta', ['id'])
  const descriptor = describeEffect('fetchUser__meta')
  assert.equal(descriptor.name, 'fetchUser__meta')
  assert.deepEqual(descriptor.params, ['id'])
  assert.equal(descriptor.sideEffecting, true)
  assert.equal(descriptor.replayable, false)
})

test('describeEffect honors explicit sideEffecting/replayable options', () => {
  defineEffect('now__meta', [], { sideEffecting: false, replayable: true })
  const descriptor = describeEffect('now__meta')
  assert.equal(descriptor.sideEffecting, false)
  assert.equal(descriptor.replayable, true)
})

test('describeEffect returns null for an unknown effect', () => {
  assert.equal(describeEffect('nonexistent__effect'), null)
})

test('describeHandlers reports handled effects with deterministic/sideEffecting/replayable metadata', async () => {
  defineEffect('fetchUser__describe', ['id'], { replayable: false })

  const report = await withHandlers(
    { fetchUser__describe: { handle: () => 'x', deterministic: false } },
    async () => describeHandlers()
  )

  const entry = report.find(e => e.name === 'fetchUser__describe')
  assert.ok(entry)
  assert.equal(entry.handled, true)
  assert.equal(entry.deterministic, false)
  assert.equal(entry.sideEffecting, true)
  assert.equal(entry.replayable, false)
})

test('describeHandlers is empty outside any handle block', () => {
  assert.deepEqual(describeHandlers(), [])
})

test('the PARALLEL builtin effect is registered by default (without any user effect declaration)', () => {
  const descriptor = describeEffect('PARALLEL')
  assert.ok(descriptor)
  assert.equal(descriptor.builtin, true)
})

test('an authorization policy permits an effect before its handler executes', async () => {
  const readTender = defineEffect('readTender__authorized', ['id'])
  const decisions = []

  const result = await withAuthorization(
    invocation => {
      decisions.push(invocation)
      return { allowed: true }
    },
    () => withHandlers({ readTender__authorized: id => ({ id }) }, () => readTender('tender-1'))
  )

  assert.deepEqual(result, { id: 'tender-1' })
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0].name, 'readTender__authorized')
  assert.deepEqual(decisions[0].args, ['tender-1'])
  assert.equal(decisions[0].effect.name, 'readTender__authorized')
})

test('a denied or missing authorization decision prevents the handler from executing', async () => {
  const sendInvitation = defineEffect('sendInvitation__denied', ['supplier'])
  let handlerCalls = 0

  for (const policy of [
    () => ({ allowed: false, reason: 'Invitation capability is not granted' }),
    () => undefined
  ]) {
    await assert.rejects(
      () => withAuthorization(
        policy,
        () => withHandlers(
          { sendInvitation__denied: () => { handlerCalls++; return 'sent' } },
          () => sendInvitation('supplier-1')
        )
      ),
      error => {
        assert.ok(error instanceof EffectAuthorizationError)
        assert.equal(error.effectName, 'sendInvitation__denied')
        return true
      }
    )
  }

  assert.equal(handlerCalls, 0)
})

test('asynchronous authorization is awaited and authorization failures preserve their cause', async () => {
  const approveOffer = defineEffect('approveOffer__async', ['id'])
  let handlerCalls = 0

  const approved = await withAuthorization(
    async () => {
      await new Promise(resolve => setTimeout(resolve, 1))
      return true
    },
    () => withHandlers({ approveOffer__async: () => { handlerCalls++; return 'approved' } }, () => approveOffer('offer-1'))
  )
  assert.equal(approved, 'approved')

  const policyFailure = new Error('policy backend unavailable')
  await assert.rejects(
    () => withAuthorization(
      async () => { throw policyFailure },
      () => withHandlers({ approveOffer__async: () => { handlerCalls++; return 'approved' } }, () => approveOffer('offer-2'))
    ),
    error => {
      assert.ok(error instanceof EffectAuthorizationError)
      assert.equal(error.cause, policyFailure)
      assert.match(error.message, /authorization callback failed/)
      return true
    }
  )
  assert.equal(handlerCalls, 1)
})

test('unhandled effects remain unhandled before authorization runs', async () => {
  const missing = defineEffect('missing__authorization', [])
  let policyCalls = 0

  await assert.rejects(
    () => withAuthorization(() => { policyCalls++; return false }, () => missing()),
    UnhandledEffectError
  )

  assert.equal(policyCalls, 0)
})

test('outer authorization scopes govern nested handlers and every parallel invocation', async () => {
  const lookupSupplier = defineEffect('lookupSupplier__nested', ['id'])
  let outerCalls = 0
  let innerCalls = 0

  const result = await withAuthorization(
    () => { outerCalls++; return true },
    () => withAuthorization(
      () => { innerCalls++; return true },
      () => withHandlers(
        { lookupSupplier__nested: id => `outer:${id}` },
        () => withHandlers(
          { lookupSupplier__nested: id => `inner:${id}` },
          () => Promise.all([lookupSupplier('one'), lookupSupplier('two')])
        )
      )
    )
  )

  assert.deepEqual(result, ['inner:one', 'inner:two'])
  assert.equal(outerCalls, 2)
  assert.equal(innerCalls, 2)
})

test('retries and replay handlers cannot bypass authorization', async () => {
  const invite = defineEffect('invite__retry_replay', ['id'])
  let policyCalls = 0
  let handlerCalls = 0

  const retried = retry(() => invite('supplier-1'), { attempts: 2 })
  const result = await withAuthorization(
    () => { policyCalls++; return true },
    () => withHandlers(
      {
        invite__retry_replay: () => {
          handlerCalls++
          if (handlerCalls === 1) throw new Error('temporary failure')
          return 'sent'
        }
      },
      retried
    )
  )

  assert.equal(result, 'sent')
  assert.equal(policyCalls, 2)

  const log = new MemoryEffectLog()
  await withHandlers(
    recordHandlers({ invite__retry_replay: () => 'recorded' }, log),
    () => invite('supplier-2')
  )

  await assert.rejects(
    () => withAuthorization(
      () => false,
      () => withHandlers(replayHandlers(['invite__retry_replay'], log), () => invite('supplier-2'))
    ),
    EffectAuthorizationError
  )

  const replayed = await withHandlers(
    replayHandlers(['invite__retry_replay'], log),
    () => invite('supplier-2')
  )
  assert.equal(replayed, 'recorded')

  let deniedPolicyCalls = 0
  let deniedHandlerCalls = 0
  await assert.rejects(
    () => withAuthorization(
      () => { deniedPolicyCalls++; return false },
      () => withHandlers(
        { invite__retry_replay: () => { deniedHandlerCalls++; return 'sent' } },
        retry(() => invite('supplier-3'), { attempts: 3 })
      )
    ),
    EffectAuthorizationError
  )
  assert.equal(deniedPolicyCalls, 1)
  assert.equal(deniedHandlerCalls, 0)
})
