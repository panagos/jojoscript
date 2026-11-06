import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { ingestInvoices } from "../dist/application/describe-example.js"
import { ExecutionContext, runInContext, MemoryCheckpointStore } from "jojoscript/runtime"

const EXAMPLE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE_FILE = path.join(EXAMPLE_ROOT, "src/application/describe-example.jojo")
const CLI = path.join(EXAMPLE_ROOT, "node_modules/jojoscript/bin/jojo.js")

test("the invoice pipeline ingests open invoices", async () => {
  const ctx = new ExecutionContext({ pipelineId: "invoices", checkpointStore: new MemoryCheckpointStore() })
  const stored = []

  const result = await runInContext(ctx, () => ingestInvoices(
    [{ id: "a", amount: 120, paid: false }, { id: "b", amount: 50, paid: true }],
    stored
  ))

  assert.deepEqual(result, [{ tag: "Open", id: "a", amount: 120 }])
  assert.deepEqual(stored, [{ tag: "Open", id: "a", amount: 120 }])
})

test("jojo describe tells an LLM what the module contains without reading its source", () => {
  const description = JSON.parse(execFileSync(process.execPath, [CLI, "describe", SOURCE_FILE], { encoding: "utf8" }))

  assert.equal(description.language, "jojo")
  assert.deepEqual(description.types, [
    { name: "Invoice", variants: [{ name: "Open", fields: ["id", "amount"] }, { name: "Settled", fields: ["id"] }] }
  ])
  assert.deepEqual(description.effects, [{ name: "storeInvoice", params: ["invoice"], handled: true }])
  assert.deepEqual(description.functions.map(fn => [fn.name, fn.purity, fn.requires]), [
    ["toInvoice", "pure", ["record.amount >= 0"]],
    ["store", "effectful", []]
  ])

  const [pipeline] = description.pipelines
  assert.equal(pipeline.name, "openInvoices")
  assert.deepEqual(pipeline.inputs, ["records"])
  assert.deepEqual(pipeline.stages.map(stage => [stage.id, stage.operation]), [
    ["unpaid", "filter"],
    ["classify", "map"],
    ["node-3", "checkpoint"]
  ])
  assert.deepEqual(pipeline.properties, { lazy: true, parallel: false, resumable: true, deterministic: true })
})

test("an invoice with a negative amount breaks the described contract", async () => {
  const ctx = new ExecutionContext({ pipelineId: "invoices-invalid", checkpointStore: new MemoryCheckpointStore() })

  await assert.rejects(
    runInContext(ctx, () => ingestInvoices([{ id: "c", amount: -1, paid: false }], [])),
    /Contract violated: toInvoice requires record.amount >= 0/
  )
})
