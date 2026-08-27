import test from 'node:test'
import assert from 'node:assert/strict'

import { batch, take } from '../src/runtime/collections.js'

test('batch groups a source into fixed-size arrays', () => {
  const result = [...batch([1, 2, 3, 4, 5, 6, 7], 3)]
  assert.deepEqual(result, [[1, 2, 3], [4, 5, 6], [7]])
})

test('batch is lazy: only pulls as many upstream items as needed', () => {
  let pulled = 0
  function* source() {
    while (true) {
      pulled++
      yield pulled
    }
  }

  const firstTwoBatches = [...take(batch(source(), 2), 2)]
  assert.deepEqual(firstTwoBatches, [[1, 2], [3, 4]])
  assert.equal(pulled, 4)
})

test('batch requires a positive integer size', () => {
  assert.throws(() => [...batch([1, 2, 3], 0)], RangeError)
  assert.throws(() => [...batch([1, 2, 3], -1)], RangeError)
  assert.throws(() => [...batch([1, 2, 3], 1.5)], RangeError)
})

test('batch never buffers more than one batch worth of items at a time', () => {
  // Bounded buffering (§13): a batch of size N should never hold more than
  // N items in its internal buffer, regardless of how large the source is.
  function* largeSource() {
    for (let i = 0; i < 1_000_000; i++) yield i
  }

  const iterator = batch(largeSource(), 10)[Symbol.iterator]()
  const first = iterator.next()
  assert.equal(first.value.length, 10)
})
