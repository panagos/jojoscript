import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { prepareShipments } from "../dist/application/stage-ids-example.js"
import { explainPipelines, planPipelines } from "jojoscript"
import { ExecutionContext, runInContext, MemoryCheckpointStore } from "jojoscript/runtime"

const SOURCE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/application/stage-ids-example.jojo"),
  "utf8"
)

test("the labelled pipeline prepares and checkpoints shipments", async () => {
  const store = new MemoryCheckpointStore()
  const ctx = new ExecutionContext({ pipelineId: "shipments", checkpointStore: store })

  const result = await runInContext(ctx, () => prepareShipments([
    { id: 1, paid: true, weightKg: 2 },
    { id: 2, paid: false, weightKg: 5 },
    { id: 3, paid: true, weightKg: 12 }
  ]))

  assert.deepEqual(result, [
    { id: 1, paid: true, weightKg: 2, carrier: "post" },
    { id: 3, paid: true, weightKg: 12, carrier: "freight" }
  ])
  assert.equal(await store.exists("shipments", "prepared"), true)
})

test("stage ids name each stage in the explanation and the plan", () => {
  const [explanation] = explainPipelines(SOURCE)
  const [plan] = planPipelines(SOURCE).pipelines

  assert.deepEqual(explanation.stages.map(stage => stage.id), [null, "paid-only", "pick-carrier", "prepared", null, null])
  assert.deepEqual(plan.stages[2], { type: "map", expression: "assignCarrier", id: "pick-carrier" })
})
