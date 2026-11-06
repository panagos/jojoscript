import test from 'node:test'
import assert from 'node:assert/strict'

import {
  deterministic,
  now,
  random,
  NondeterministicEffectError,
  defineEffect,
  withHandlers,
  replayHandlers,
  MemoryEffectLog,
  parallel,
  map,
  toArrayAsync,
  checkpoint,
  MemoryCheckpointStore,
  ExecutionContext,
  runInContext
} from '../src/runtime/index.js'

test('outside deterministic mode now() and random() use the real clock and Math.random', () => {
  const before = Date.now()
  const value = random()

  assert.ok(now() >= before)
  assert.ok(value >= 0 && value < 1)
})

test('the same seed always produces the same random numbers and clock readings', async () => {
  const run = seed => deterministic(() => [random(), random(), now(), now()], { seed, startTime: 1000 })

  const first = await run(42)
  assert.deepEqual(await run(42), first)
  assert.notDeepEqual((await run(7)).slice(0, 2), first.slice(0, 2))
  assert.deepEqual(first.slice(2), [1000, 1001])
  assert.ok(first.slice(0, 2).every(value => value >= 0 && value < 1))
})

test('TIME and RANDOM handlers can be installed directly', async () => {
  const values = await withHandlers({ TIME: () => 5, RANDOM: () => 0.25 }, () => [now(), random()])
  assert.deepEqual(values, [5, 0.25])
})

test('an effect without a deterministic handler is rejected inside deterministic mode', async () => {
  const fetchRate = defineEffect('fetchRate__deterministic', ['currency'])

  await assert.rejects(
    deterministic(() => withHandlers({ fetchRate__deterministic: () => 1.1 }, () => fetchRate('EUR'))),
    error => {
      assert.ok(error instanceof NondeterministicEffectError)
      assert.equal(error.effectName, 'fetchRate__deterministic')
      assert.equal(error.retryable, false)
      assert.match(error.message, /Effect "fetchRate__deterministic" has no deterministic handler/)
      return true
    }
  )
})

test('deterministic and replay handlers are allowed inside deterministic mode', async () => {
  const fetchRate = defineEffect('fetchRate__allowed', ['currency'])
  const log = new MemoryEffectLog()
  await log.record({ name: 'fetchRate__allowed', args: ['USD'], result: 0.9 })

  const declared = await deterministic(() =>
    withHandlers({ fetchRate__allowed: { handle: () => 1.1, deterministic: true } }, () => fetchRate('EUR')))
  const replayed = await deterministic(() =>
    withHandlers(replayHandlers(['fetchRate__allowed'], log), () => fetchRate('USD')))

  assert.equal(declared, 1.1)
  assert.equal(replayed, 0.9)
})

test('parallel stages run one item at a time inside deterministic mode', async () => {
  let running = 0
  let maxRunning = 0
  const slow = async value => {
    running++
    maxRunning = Math.max(maxRunning, running)
    await new Promise(resolve => setTimeout(resolve, 5))
    running--
    return value * 2
  }

  const result = await deterministic(() => toArrayAsync(map(parallel([1, 2, 3], 3), slow)))

  assert.deepEqual(result, [2, 4, 6])
  assert.equal(maxRunning, 1)
})

test('checkpoints written in deterministic mode carry the deterministic clock time', async () => {
  const store = new MemoryCheckpointStore()
  const ctx = new ExecutionContext({ pipelineId: 'deterministic-checkpoint', checkpointStore: store })

  await deterministic(() => runInContext(ctx, () => toArrayAsync(checkpoint([1, 2], 'saved'))), { startTime: 0 })

  assert.equal((await store.load('deterministic-checkpoint', 'saved')).createdAt, '1970-01-01T00:00:00.000Z')
})
