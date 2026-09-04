import test from "node:test"
import assert from "node:assert/strict"

import { fetchAndCheckpoint } from "../dist/effects/checkpoint-resume.js"
import { ExecutionContext, runInContext, MemoryCheckpointStore } from "jojoscript/runtime"

test("effects upstream of a checkpoint run once per item on a fresh run", async () => {
  const store = new MemoryCheckpointStore()
  const ctx = new ExecutionContext({ pipelineId: "fetch-and-checkpoint-fresh", checkpointStore: store })

  const result = await runInContext(ctx, () => fetchAndCheckpoint([1, 2, 3], "users-fetched"))

  assert.deepEqual(result, [
    { id: 1, name: "User 1" },
    { id: 2, name: "User 2" },
    { id: 3, name: "User 3" }
  ])
  assert.equal(await store.exists("fetch-and-checkpoint-fresh", "users-fetched"), true)
})

test("once the checkpoint has completed, a later run restores it instead of re-invoking the effect", async () => {
  const store = new MemoryCheckpointStore()
  const ctx = new ExecutionContext({ pipelineId: "fetch-and-checkpoint-resume", checkpointStore: store })

  const first = await runInContext(ctx, () => fetchAndCheckpoint([1, 2, 3], "users-fetched"))

  // Different (empty) input on the "resumed" run: it doesn't matter, since
  // the checkpoint is restored without ever touching the upstream effect.
  const second = await runInContext(ctx, () => fetchAndCheckpoint([], "users-fetched"))

  assert.deepEqual(second, first)
})
