import test from "node:test"
import assert from "node:assert/strict"

import { summarizeResponse } from "../dist/application/structured-match-example.js"

test("object patterns pick the arm whose shape matches the response", () => {
  assert.equal(summarizeResponse({ status: "ok", data: { items: [1, 2, 3] } }), "3 items")
  assert.equal(summarizeResponse({ status: "error", error: { code: 404 } }), "not found")
  assert.equal(
    summarizeResponse({ status: "error", error: { code: 500, message: "boom" } }),
    "failed: boom"
  )
})

test("a response with an unexpected shape is rejected instead of silently ignored", () => {
  assert.throws(() => summarizeResponse({ status: "pending" }), {
    name: "TypeError",
    message: "No match arm matched the value"
  })
})
