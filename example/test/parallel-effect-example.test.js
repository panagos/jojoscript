import test from "node:test"
import assert from "node:assert/strict"

import {
  processItemsConcurrently,
  processItemsWithRecordedOrder
} from "../dist/effects/parallel-effect.js"

test("parallel(n) uses the default bounded-concurrency pool with no handler installed", async () => {
  const result = await processItemsConcurrently([1, 2, 3, 4])
  assert.deepEqual(result, [2, 4, 6, 8])
})

test("a PARALLEL handler can reinterpret parallel(n) as deterministic, recorded-order execution", async () => {
  const order = []
  const result = await processItemsWithRecordedOrder([1, 2, 3, 4], order)
  assert.deepEqual(result, [2, 4, 6, 8])
  assert.deepEqual(order, [1, 2, 3, 4])
})
