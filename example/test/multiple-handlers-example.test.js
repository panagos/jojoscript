import test from "node:test"
import assert from "node:assert/strict"

import {
  syncUserWithProductionHandlers,
  syncUserWithTestHandlers
} from "../dist/effects/multiple-handlers.js"

test("the production handlers fetch and save through their own implementations", async () => {
  const result = await syncUserWithProductionHandlers(1)
  assert.deepEqual(result, { id: 1, name: "User 1", source: "http", savedTo: "database" })
})

test("the exact same program run with test handlers produces different (deterministic) results", async () => {
  const result = await syncUserWithTestHandlers(1)
  assert.deepEqual(result, { id: 1, name: "Fake User", source: "memory", savedTo: "in-memory-store" })
})
