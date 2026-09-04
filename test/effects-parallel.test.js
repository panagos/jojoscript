import test from 'node:test'
import assert from 'node:assert/strict'

import { parallel, map, toArrayAsync } from '../src/runtime/collections.js'
import { withHandlers } from '../src/runtime/effects.js'

test('parallel() without any handler installed behaves exactly as before (default concurrency)', async () => {
  const items = Array.from({ length: 20 }, (_, i) => i)
  let active = 0
  let maxActive = 0

  async function work(n) {
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise(resolve => setTimeout(resolve, 2))
    active--
    return n * 2
  }

  const result = await toArrayAsync(map(parallel(items, 4), work))
  assert.deepEqual(result, items.map(n => n * 2))
  assert.ok(maxActive > 1 && maxActive <= 4)
})

test('a PARALLEL handler intercepts parallel(n) and can run it deterministically/sequentially', async () => {
  const items = [1, 2, 3, 4, 5]
  const order = []

  async function deterministicParallel({ items, fn }) {
    const results = []
    let i = 0
    for await (const item of items) {
      order.push(item)
      results.push(await fn(item, i++))
    }
    return results
  }

  const result = await withHandlers(
    { PARALLEL: deterministicParallel },
    async () => toArrayAsync(map(parallel(items, 8), async n => n * 10))
  )

  assert.deepEqual(result, [10, 20, 30, 40, 50])
  assert.deepEqual(order, items)
})

test('a debugging PARALLEL handler can record scheduling information alongside real results', async () => {
  const items = [1, 2, 3]
  const log = []

  async function recordingParallel({ items, fn, concurrency }) {
    const results = []
    let i = 0
    for await (const item of items) {
      const startedAt = Date.now()
      const value = await fn(item, i++)
      log.push({ item, concurrency, tookMs: Date.now() - startedAt })
      results.push(value)
    }
    return results
  }

  const result = await withHandlers(
    { PARALLEL: recordingParallel },
    async () => toArrayAsync(map(parallel(items, 3), async n => n + 1))
  )

  assert.deepEqual(result, [2, 3, 4])
  assert.equal(log.length, 3)
  assert.ok(log.every(entry => entry.concurrency === 3))
})

test('after the handle block ends, parallel() falls back to the default implementation again', async () => {
  const items = [1, 2, 3]

  await withHandlers(
    { PARALLEL: async ({ items }) => { const out = []; for await (const i of items) out.push(i); return out } },
    async () => toArrayAsync(map(parallel(items, 2), async n => n))
  )

  // No handler active anymore: default bounded-concurrency behavior applies.
  const result = await toArrayAsync(map(parallel(items, 2), async n => n * 100))
  assert.deepEqual(result, [100, 200, 300])
})
