import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { enrichOrders } from "../dist/application/named-pipeline-example.js"
import { ExecutionContext, runInContext, MemoryCheckpointStore } from "jojoscript/runtime"

const EXAMPLE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE_FILE = path.join(EXAMPLE_ROOT, "src/application/named-pipeline-example.jojo")
const CLI = path.join(EXAMPLE_ROOT, "node_modules/jojoscript/bin/jojo.js")

test("a named pipeline is called like a function with its source as the input", async () => {
  const ctx = new ExecutionContext({ pipelineId: "orders", checkpointStore: new MemoryCheckpointStore() })

  const result = await runInContext(ctx, () => enrichOrders([
    { id: 1, active: true, amount: 10 },
    { id: 2, active: false, amount: 20 }
  ]))

  assert.deepEqual(result, [{ id: 1, active: true, amount: 10, amountWithVat: 12 }])
})

test("jojo explain can select the named pipeline", () => {
  const stdout = execFileSync(process.execPath, [CLI, "explain", SOURCE_FILE, "--pipeline", "enrichOrders"], { encoding: "utf8" })

  assert.match(stdout, /^PIPELINE enrichOrders\n\nSTAGES\n {2}1 source {7}orders\n/)
  assert.match(stdout, /resumable: true/)
})
