import test from "node:test"
import assert from "node:assert/strict"

import {
  summarizeUser,
  firstAndRest,
  swap,
  pointDistance
} from "../dist/application/destructuring-example.js"

test("object destructuring declaration", () => {
  const summary = summarizeUser({ id: 1, name: "Ada", roles: ["admin", "editor"] })
  assert.equal(summary, "#1 Ada (admin, editor)")
})

test("array destructuring declaration with rest", () => {
  assert.deepEqual(firstAndRest([1, 2, 3]), { head: 1, rest: [2, 3] })
})

test("tuple multi-binding declaration swaps two mutable bindings", () => {
  assert.deepEqual(swap(1, 2), [2, 1])
})

test("nested object destructuring declaration", () => {
  const distance = pointDistance({ x: 0, y: 0 }, { x: 3, y: 4 })
  assert.equal(distance, 5)
})
