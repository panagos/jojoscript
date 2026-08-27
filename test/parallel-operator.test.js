import test from 'node:test'
import assert from 'node:assert/strict'

import { parallel, map, toArrayAsync } from '../src/runtime/collections.js'

test('parallel(n) tags the source but does not run anything by itself', () => {
  let ran = false
  const tagged = parallel({
    [Symbol.iterator]() {
      ran = true
      return [][Symbol.iterator]()
    }
  }, 4)

  assert.equal(ran, false)
  assert.equal(typeof tagged, 'object')
})

test('parallel requires a positive integer concurrency', () => {
  assert.throws(() => parallel([1, 2, 3], 0), RangeError)
  assert.throws(() => parallel([1, 2, 3], -1), RangeError)
  assert.throws(() => parallel([1, 2, 3], 1.5), RangeError)
})

test('map(parallel(items, n)) preserves item order in the results', async () => {
  const items = Array.from({ length: 25 }, (_, i) => i)

  async function work(n) {
    await new Promise(resolve => setTimeout(resolve, (25 - n) % 5))
    return n * 2
  }

  const result = await toArrayAsync(map(parallel(items, 5), work))
  assert.deepEqual(result, items.map(n => n * 2))
})

test('map(parallel(items, n)) never runs more than n calls concurrently', async () => {
  const items = Array.from({ length: 30 }, (_, i) => i)
  let active = 0
  let maxActive = 0

  async function work(n) {
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active--
    return n
  }

  await toArrayAsync(map(parallel(items, 4), work))
  assert.ok(maxActive <= 4, `expected max 4 concurrent calls, saw ${maxActive}`)
  assert.ok(maxActive > 1, 'expected some real concurrency, not fully serialized')
})

test('map(parallel(items, n)) works correctly even when the mapper resolves to falsy values like 0', async () => {
  // Regression test: an earlier implementation used the mapper's
  // *resolved value* as a truthy "is there more work" sentinel, which
  // broke as soon as a call resolved to 0 (or '', null, false).
  const items = [0, 1, 2, 3, 4, 5, 6]
  const result = await toArrayAsync(map(parallel(items, 3), async n => n))
  assert.deepEqual(result, items)
})

test('map(parallel(items, n)) propagates a rejected mapper call', async () => {
  const items = [1, 2, 3, 4]

  await assert.rejects(
    () => toArrayAsync(map(parallel(items, 2), async n => {
      if (n === 3) throw new Error('item 3 failed')
      return n
    })),
    /item 3 failed/
  )
})

test('map(parallel(items, n)) handles fewer items than the concurrency limit', async () => {
  const result = await toArrayAsync(map(parallel([1, 2], 8), async n => n * 10))
  assert.deepEqual(result, [10, 20])
})

test('map(parallel(items, n)) handles an empty source', async () => {
  const result = await toArrayAsync(map(parallel([], 4), async n => n))
  assert.deepEqual(result, [])
})

test('map without parallel() stays fully sequential (existing behavior preserved)', () => {
  const order = []
  const result = [...map([1, 2, 3], n => {
    order.push(n)
    return n * 2
  })]
  assert.deepEqual(result, [2, 4, 6])
  assert.deepEqual(order, [1, 2, 3])
})
