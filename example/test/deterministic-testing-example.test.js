import test from "node:test"
import assert from "node:assert/strict"

import { withRealClock, withFixedClock } from "../dist/effects/deterministic-testing.js"

test("the test handler makes the program fully deterministic", async () => {
  const first = await withFixedClock("build finished", "2026-01-01T00:00:00.000Z")
  const second = await withFixedClock("build finished", "2026-01-01T00:00:00.000Z")
  assert.equal(first, "build finished @ 2026-01-01T00:00:00.000Z")
  assert.equal(first, second)
})

test("the production-like handler uses the real clock (not asserted exactly, only shaped)", async () => {
  const message = await withRealClock("build finished")
  assert.match(message, /^build finished @ \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
})
