import test from 'node:test'
import assert from 'node:assert/strict'

import { checkpoint } from '../src/runtime/checkpoint.js'
import { MemoryCheckpointStore } from '../src/runtime/checkpoint-store.js'
import { ExecutionContext, runInContext } from '../src/runtime/execution-context.js'

async function collect(iterable) {
  const result = []
  for await (const item of iterable) result.push(item)
  return result
}

function contextWith(overrides = {}) {
  return new ExecutionContext({
    pipelineId: 'pipeline-1',
    checkpointStore: new MemoryCheckpointStore(),
    ...overrides
  })
}

test('a fresh checkpoint streams items through and durably saves them', async () => {
  const ctx = contextWith()

  const result = await runInContext(ctx, () =>
    collect(checkpoint([1, 2, 3], 'stage-a', {}))
  )

  assert.deepEqual(result, [1, 2, 3])
  assert.equal(await ctx.checkpointStore.exists('pipeline-1', 'stage-a'), true)
  assert.deepEqual((await ctx.checkpointStore.load('pipeline-1', 'stage-a')).items, [1, 2, 3])
})

test('an existing checkpoint is loaded without ever touching the upstream iterable', async () => {
  const ctx = contextWith()
  await ctx.checkpointStore.save({ pipelineId: 'pipeline-1', checkpointId: 'stage-a', items: [9, 9, 9] })

  let upstreamTouched = false
  function* upstream() {
    upstreamTouched = true
    yield 1
  }

  const result = await runInContext(ctx, () =>
    collect(checkpoint(upstream(), 'stage-a', {}))
  )

  assert.deepEqual(result, [9, 9, 9])
  assert.equal(upstreamTouched, false)
})

test('a failure before the checkpoint completes leaves no checkpoint behind', async () => {
  const ctx = contextWith()

  async function* upstream() {
    yield 1
    yield 2
    throw new Error('boom')
  }

  await assert.rejects(
    () => runInContext(ctx, () => collect(checkpoint(upstream(), 'stage-a', {}))),
    /boom/
  )

  assert.equal(await ctx.checkpointStore.exists('pipeline-1', 'stage-a'), false)
})

test('a failure after the checkpoint (downstream) does not affect a resume: the checkpoint is still there', async () => {
  const ctx = contextWith()
  await runInContext(ctx, () => collect(checkpoint([1, 2, 3], 'stage-a', {})))

  // Simulate downstream blowing up on a later run; the checkpoint from the
  // successful run must still be loadable.
  assert.equal(await ctx.checkpointStore.exists('pipeline-1', 'stage-a'), true)
  const secondRun = await runInContext(ctx, () => collect(checkpoint([], 'stage-a', {})))
  assert.deepEqual(secondRun, [1, 2, 3])
})

test('replaying from a checkpoint that does not exist throws a clear error', async () => {
  const ctx = contextWith({ replayFrom: 'stage-a' })

  await assert.rejects(
    () => runInContext(ctx, () => collect(checkpoint([1, 2, 3], 'stage-a', { checkpointOrder: ['stage-a'], checkpointIndex: 0 }))),
    /Cannot replay from checkpoint "stage-a"/
  )
})

test('replaying from an existing checkpoint loads it directly', async () => {
  const ctx = contextWith({ replayFrom: 'stage-a' })
  await ctx.checkpointStore.save({ pipelineId: 'pipeline-1', checkpointId: 'stage-a', items: [7, 8] })

  const result = await runInContext(ctx, () =>
    collect(checkpoint([1, 2, 3], 'stage-a', { checkpointOrder: ['stage-a'], checkpointIndex: 0 }))
  )

  assert.deepEqual(result, [7, 8])
})

test('replaying from an earlier checkpoint forces a later checkpoint to recompute instead of reusing stale data', async () => {
  const ctx = contextWith({ replayFrom: 'a' })
  await ctx.checkpointStore.save({ pipelineId: 'pipeline-1', checkpointId: 'a', items: [1, 2] })
  await ctx.checkpointStore.save({ pipelineId: 'pipeline-1', checkpointId: 'b', items: [999] }) // stale

  const order = ['a', 'b']

  // Node "a" (index 0) is the replay target: loaded directly.
  const stageA = await runInContext(ctx, () =>
    collect(checkpoint([], 'a', { checkpointOrder: order, checkpointIndex: 0 }))
  )
  assert.deepEqual(stageA, [1, 2])

  // Node "b" (index 1, after the replay target) must recompute (ignore the
  // stale saved [999]) using the fresh upstream data instead.
  const stageB = await runInContext(ctx, () =>
    collect(checkpoint(stageA.map(n => n * 10), 'b', { checkpointOrder: order, checkpointIndex: 1 }))
  )
  assert.deepEqual(stageB, [10, 20])
  assert.deepEqual((await ctx.checkpointStore.load('pipeline-1', 'b')).items, [10, 20])
})

test('a checkpoint before the replay target is still loaded normally if present', async () => {
  const ctx = contextWith({ replayFrom: 'b' })
  await ctx.checkpointStore.save({ pipelineId: 'pipeline-1', checkpointId: 'a', items: [1, 2] })
  await ctx.checkpointStore.save({ pipelineId: 'pipeline-1', checkpointId: 'b', items: [3, 4] })

  const order = ['a', 'b']

  let upstreamTouched = false
  function* upstream() {
    upstreamTouched = true
    yield 'should not run'
  }

  const stageA = await runInContext(ctx, () =>
    collect(checkpoint(upstream(), 'a', { checkpointOrder: order, checkpointIndex: 0 }))
  )

  assert.deepEqual(stageA, [1, 2])
  assert.equal(upstreamTouched, false)
})

test('falls back to a default pipelineId when no context pipelineId is set', async () => {
  const store = new MemoryCheckpointStore()
  const ctx = new ExecutionContext({ checkpointStore: store })

  await runInContext(ctx, () => collect(checkpoint([1], 'x', { pipelineId: 'from-meta' })))

  assert.equal(await store.exists('from-meta', 'x'), true)
})
