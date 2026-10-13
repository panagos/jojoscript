import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { checkpointRecords } from "../dist/effects/checkpoint-integrity.js"
import { ExecutionContext, FileCheckpointStore, runInContext } from "jojoscript/runtime"

test("a compiled checkpoint pipeline rejects malformed persisted metadata on resume", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jojo-checkpoint-integrity-"))
  const store = new FileCheckpointStore(directory)
  const context = new ExecutionContext({
    pipelineId: "checkpoint-integrity",
    checkpointStore: store
  })

  try {
    assert.deepEqual(
      await runInContext(context, () => checkpointRecords([1, 2], "records")),
      [1, 2]
    )

    fs.writeFileSync(store.filePath("checkpoint-integrity", "records"), JSON.stringify({
      pipelineId: "checkpoint-integrity",
      checkpointId: "records",
      items: [1, 2],
      itemCount: 3
    }))

    await assert.rejects(
      () => runInContext(context, () => checkpointRecords([], "records")),
      /Invalid checkpoint "records": itemCount does not match items/
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
