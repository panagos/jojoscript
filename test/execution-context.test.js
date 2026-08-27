import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ExecutionContext,
  runInContext,
  getCurrentContext,
  getDefaultContext,
  resetDefaultContext
} from '../src/runtime/execution-context.js'
import { FileCheckpointStore } from '../src/runtime/checkpoint-store.js'
import { Metrics } from '../src/runtime/metrics.js'

test('ExecutionContext fills in sensible defaults', () => {
  const ctx = new ExecutionContext()
  assert.equal(ctx.pipelineId, null)
  assert.ok(ctx.executionId)
  assert.ok(ctx.startedAt)
  assert.equal(ctx.currentNode, null)
  assert.ok(ctx.metrics instanceof Metrics)
  assert.ok(ctx.checkpointStore instanceof FileCheckpointStore)
  assert.deepEqual(ctx.options, {})
  assert.equal(ctx.replayFrom, null)
  assert.equal(ctx.quiet, false)
})

test('ExecutionContext accepts explicit overrides', () => {
  const store = new FileCheckpointStore('/tmp/whatever')
  const ctx = new ExecutionContext({
    pipelineId: 'p1',
    executionId: 'e1',
    checkpointStore: store,
    replayFrom: 'stage-a',
    quiet: true
  })

  assert.equal(ctx.pipelineId, 'p1')
  assert.equal(ctx.executionId, 'e1')
  assert.equal(ctx.checkpointStore, store)
  assert.equal(ctx.replayFrom, 'stage-a')
  assert.equal(ctx.quiet, true)
})

test('two contexts get different random execution ids', () => {
  const a = new ExecutionContext()
  const b = new ExecutionContext()
  assert.notEqual(a.executionId, b.executionId)
})

test('getCurrentContext is undefined outside of runInContext', () => {
  assert.equal(getCurrentContext(), undefined)
})

test('runInContext makes the context available via getCurrentContext, including across awaits', async () => {
  const ctx = new ExecutionContext({ pipelineId: 'inside' })

  const seen = await runInContext(ctx, async () => {
    await new Promise(resolve => setTimeout(resolve, 1))
    return getCurrentContext()
  })

  assert.equal(seen, ctx)
  assert.equal(getCurrentContext(), undefined) // not leaked outside
})

test('getDefaultContext prefers an active runInContext context', () => {
  const ctx = new ExecutionContext({ pipelineId: 'active' })
  const seen = runInContext(ctx, () => getDefaultContext())
  assert.equal(seen, ctx)
})

test('getDefaultContext memoizes a single default context per process when none is active', () => {
  resetDefaultContext()
  const first = getDefaultContext()
  const second = getDefaultContext()
  assert.equal(first, second)
  resetDefaultContext()
})

test('getDefaultContext honors JOJO_CHECKPOINT_DIR and JOJO_REPLAY_FROM', () => {
  resetDefaultContext()
  const previousDir = process.env.JOJO_CHECKPOINT_DIR
  const previousReplay = process.env.JOJO_REPLAY_FROM

  process.env.JOJO_CHECKPOINT_DIR = '/tmp/custom-checkpoints'
  process.env.JOJO_REPLAY_FROM = 'my-stage'

  const ctx = getDefaultContext()
  assert.equal(ctx.checkpointStore.baseDir, '/tmp/custom-checkpoints')
  assert.equal(ctx.replayFrom, 'my-stage')

  if (previousDir === undefined) delete process.env.JOJO_CHECKPOINT_DIR
  else process.env.JOJO_CHECKPOINT_DIR = previousDir
  if (previousReplay === undefined) delete process.env.JOJO_REPLAY_FROM
  else process.env.JOJO_REPLAY_FROM = previousReplay
  resetDefaultContext()
})
