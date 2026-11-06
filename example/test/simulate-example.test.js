import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { syncPrices } from "../dist/application/simulate-example.js"
import { ExecutionContext, runInContext, MemoryCheckpointStore } from "jojoscript/runtime"

const EXAMPLE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE_FILE = path.join(EXAMPLE_ROOT, "src/application/simulate-example.jojo")
const CLI = path.join(EXAMPLE_ROOT, "node_modules/jojoscript/bin/jojo.js")

test("the price sync runs for real on a few products", async () => {
  const ctx = new ExecutionContext({ pipelineId: "prices", checkpointStore: new MemoryCheckpointStore() })

  const result = await runInContext(ctx, () => syncPrices([
    { sku: "a", active: true },
    { sku: "b", active: false }
  ]))

  assert.deepEqual(result, [{ sku: "a", active: true, price: 10 }])
})

test("jojo simulate shows what a quarter of a million products would cost, without running anything", () => {
  const stdout = execFileSync(process.execPath, [CLI, "simulate", SOURCE_FILE, "--input", "250000", "--pipeline", "pricedProducts"], { encoding: "utf8" })

  assert.match(stdout, /^SIMULATION pricedProducts\n\nINPUT\n {2}250,000 records\n/)
  assert.match(stdout, / {2}3 parallel {3}≤250,000 items in, 16 workers\n/)
  assert.match(stdout, /⚠ stage 4: up to 250,000 calls to effect "fetchPrice"/)
  assert.match(stdout, /⚠ stage 4: effect "fetchPrice" runs before checkpoint "priced"/)
})
