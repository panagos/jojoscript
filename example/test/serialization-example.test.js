import test from "node:test"
import assert from "node:assert/strict"

import { snapshotOrder, restoreOrder } from "../dist/application/serialization-example.js"

const order = {
  id: 7,
  placedAt: new Date("2026-03-01T10:00:00.000Z"),
  quantities: new Map([["apples", 3], ["pears", 1]])
}

test("snapshots are identical regardless of property order", () => {
  const reordered = { quantities: order.quantities, placedAt: order.placedAt, id: order.id }

  assert.equal(snapshotOrder(order), snapshotOrder(reordered))
  assert.match(snapshotOrder(order), /^\{"id":7,"placedAt":\{"\$type":"Date"/)
})

test("restoring a snapshot gives back dates and maps, and pipelines keep working on it", () => {
  const restored = restoreOrder(snapshotOrder(order))

  assert.ok(restored.placedAt instanceof Date)
  assert.ok(restored.quantities instanceof Map)
  assert.equal(restored.totalItems, 4)
})
