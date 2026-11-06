import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { enrichPaidOrders } from "../dist/application/explain-example.js"
import { explainPipelines } from "jojoscript"
import { ExecutionContext, runInContext, MemoryCheckpointStore } from "jojoscript/runtime"

const EXAMPLE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE_FILE = path.join(EXAMPLE_ROOT, "src/application/explain-example.jojo")
const CLI = path.join(EXAMPLE_ROOT, "node_modules/jojoscript/bin/jojo.js")

const ORDERS = [
  { id: 1, status: "paid", country: "GR" },
  { id: 2, status: "pending", country: "US" },
  { id: 3, status: "paid", country: "US" }
]

test("the explained pipeline enriches and checkpoints paid orders when it runs", async () => {
  const store = new MemoryCheckpointStore()
  const ctx = new ExecutionContext({ pipelineId: "explain-example", checkpointStore: store })

  const result = await runInContext(ctx, () => enrichPaidOrders(ORDERS))

  assert.deepEqual(result, [
    { id: 1, status: "paid", country: "GR", region: "EU" },
    { id: 3, status: "paid", country: "US", region: "INTL" }
  ])
  assert.equal(await store.exists("explain-example", "enriched-orders"), true)
})

test("explainPipelines tells an LLM what the example pipeline means without running it", () => {
  const [explanation] = explainPipelines(fs.readFileSync(SOURCE_FILE, "utf8"))

  assert.equal(explanation.name, "enrichPaidOrders")
  assert.deepEqual(explanation.stages.map(stage => [stage.type, stage.detail]), [
    ["source", "orders"],
    ["filter", "pure"],
    ["parallel", "concurrency=4"],
    ["map", "effectful: enrichOrder"],
    ["checkpoint", "enriched-orders"],
    ["toArrayAsync", "pure"],
    ["await", "control"]
  ])
  assert.deepEqual(explanation.effects, [{ name: "enrichOrder", staticallyHandled: true }])
  assert.deepEqual(explanation.properties, {
    lazy: true,
    parallel: true,
    resumable: true,
    deterministic: false
  })
})

test("jojo explain prints the same explanation from the command line", () => {
  const stdout = execFileSync(process.execPath, [CLI, "explain", SOURCE_FILE], { encoding: "utf8" })

  assert.equal(stdout, [
    "PIPELINE enrichPaidOrders",
    "",
    "STAGES",
    "  1 source       orders",
    "  2 filter       pure",
    "  3 parallel     concurrency=4",
    "  4 map          effectful: enrichOrder",
    "  5 checkpoint   enriched-orders",
    "  6 toArrayAsync pure",
    "  7 await        control",
    "",
    "EFFECTS",
    "  enrichOrder (handler declared)",
    "",
    "PROPERTIES",
    "  lazy: true",
    "  parallel: true",
    "  resumable: true",
    "  deterministic: false",
    ""
  ].join("\n"))
})
