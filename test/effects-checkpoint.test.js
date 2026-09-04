import test from 'node:test'
import assert from 'node:assert/strict'

import { checkpoint } from '../src/runtime/checkpoint.js'
import { MemoryCheckpointStore } from '../src/runtime/checkpoint-store.js'
import { ExecutionContext, runInContext } from '../src/runtime/execution-context.js'
import { defineEffect, withHandlers } from '../src/runtime/effects.js'

/*
 * Documents and tests the semantics of effects placed *before* a
 * `checkpoint()` stage (see README's "Effects and checkpoint/resume").
 *
 * `checkpoint(items, name)` either:
 *   - streams `items` through once and durably saves everything it saw, or
 *   - if a completed checkpoint already exists, returns the saved items
 *     WITHOUT ever touching (calling `.next()` on) the upstream iterable.
 *
 * Effects invoked by upstream `map`/`tap`/... stages are just ordinary
 * function calls that happen to run while that upstream generator is
 * pulled. This gives effects before a checkpoint a specific, non-magical
 * guarantee:
 *
 *   - if the checkpoint previously completed, upstream effects are NOT
 *     re-executed on a later run — the saved items are used instead.
 *   - if the checkpoint did NOT previously complete (crash/first run),
 *     upstream effects run again from scratch the next time the pipeline
 *     is (re)executed, since a checkpoint is only durably saved after
 *     100% of its items have passed through. There is no per-item resume.
 *
 * This is deliberately NOT exactly-once effect execution: it is
 * "at-least-once until the checkpoint fully completes, then exactly zero
 * additional times after". A non-idempotent, non-replayable effect
 * (`replayable: false`, the default) must tolerate being called again on
 * a crash-and-retry before its checkpoint completes.
 */

async function collect(iterable) {
  const result = []
  for await (const item of iterable) result.push(item)
  return result
}

function contextWith(overrides = {}) {
  return new ExecutionContext({
    pipelineId: 'effects-checkpoint-pipeline',
    checkpointStore: new MemoryCheckpointStore(),
    ...overrides
  })
}

test('an effect upstream of a checkpoint runs once per item on a fresh run', async () => {
  const fetchUser = defineEffect('fetchUser__ckpt-fresh', ['id'], { replayable: false })
  const ctx = contextWith()
  let calls = 0

  async function* fetchAll() {
    for (const id of [1, 2, 3]) yield await fetchUser(id)
  }

  const result = await withHandlers(
    { 'fetchUser__ckpt-fresh': async id => { calls++; return { id } } },
    () => runInContext(ctx, () => collect(checkpoint(fetchAll(), 'users-fetched', {})))
  )

  assert.deepEqual(result, [{ id: 1 }, { id: 2 }, { id: 3 }])
  assert.equal(calls, 3)
})

test('once the checkpoint has completed, a later run does NOT re-invoke the upstream effect at all', async () => {
  const fetchUser = defineEffect('fetchUser__ckpt-restore', ['id'], { replayable: false })
  const ctx = contextWith()
  let calls = 0

  async function* fetchAll() {
    for (const id of [1, 2, 3]) yield await fetchUser(id)
  }

  const firstRun = await withHandlers(
    { 'fetchUser__ckpt-restore': async id => { calls++; return { id, name: `user-${id}` } } },
    () => runInContext(ctx, () => collect(checkpoint(fetchAll(), 'users-fetched', {})))
  )

  assert.equal(calls, 3)
  assert.deepEqual(firstRun, [{ id: 1, name: 'user-1' }, { id: 2, name: 'user-2' }, { id: 3, name: 'user-3' }])

  // Second "run": no handler installed at all (simulating a process restart
  // where nothing about handler wiring matters) — if the upstream effect
  // were re-invoked it would throw UnhandledEffectError since there is no
  // active handler anymore. It is not invoked at all, proving restoration
  // comes from the checkpoint, not from re-running (or replaying) the effect.
  const secondRun = await runInContext(ctx, () => collect(checkpoint(fetchAll(), 'users-fetched', {})))

  assert.equal(calls, 3, 'the upstream effect must not run again once the checkpoint is complete')
  assert.deepEqual(secondRun, firstRun)
})

test('a crash before the checkpoint completes means the upstream effect WILL run again on retry (no per-item resume)', async () => {
  const fetchUser = defineEffect('fetchUser__ckpt-crash', ['id'], { replayable: false })
  const ctx = contextWith()
  const calls = []

  async function* fetchThenCrash() {
    for (const id of [1, 2, 3]) {
      yield await fetchUser(id)
      if (id === 2) throw new Error('simulated crash mid-pipeline')
    }
  }

  await assert.rejects(
    () => withHandlers(
      { 'fetchUser__ckpt-crash': async id => { calls.push(id); return { id } } },
      () => runInContext(ctx, () => collect(checkpoint(fetchThenCrash(), 'users-fetched', {})))
    ),
    /simulated crash/
  )

  assert.deepEqual(calls, [1, 2])
  assert.equal(await ctx.checkpointStore.exists('effects-checkpoint-pipeline', 'users-fetched'), false)

  // Retry from the start: ids 1 and 2 are fetched *again* because the
  // checkpoint never completed and saved nothing.
  async function* fetchAllAgain() {
    for (const id of [1, 2, 3]) yield await fetchUser(id)
  }

  const retried = await withHandlers(
    { 'fetchUser__ckpt-crash': async id => { calls.push(id); return { id } } },
    () => runInContext(ctx, () => collect(checkpoint(fetchAllAgain(), 'users-fetched', {})))
  )

  assert.deepEqual(retried, [{ id: 1 }, { id: 2 }, { id: 3 }])
  assert.deepEqual(calls, [1, 2, 1, 2, 3], 'ids 1 and 2 were fetched twice: no exactly-once guarantee')
})
