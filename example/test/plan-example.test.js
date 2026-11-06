import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { topCustomers } from "../dist/application/plan-example.js"
import { compile, planPipelines } from "jojoscript"

const EXAMPLE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE_FILE = path.join(EXAMPLE_ROOT, "src/application/plan-example.jojo")
const CLI = path.join(EXAMPLE_ROOT, "node_modules/jojoscript/bin/jojo.js")
const PLAN_FILE = path.join(EXAMPLE_ROOT, "dist/application/plan-example.plan.json")
const GENERATED_FILE = path.join(EXAMPLE_ROOT, "dist/application/plan-example.generated.js")

const CUSTOMERS = [
  { name: "Ada", active: true, spend: 900 },
  { name: "Grace", active: false, spend: 1200 },
  { name: "Linus", active: true, spend: 700 },
  { name: "Ken", active: true, spend: 300 }
]

function jojo(...args) {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" })
}

test("the planned pipeline selects the top active customers when it runs", () => {
  assert.deepEqual(topCustomers(CUSTOMERS), ["Ada", "Linus"])
})

test("planPipelines describes the example as a canonical JSON plan", () => {
  const plan = planPipelines(fs.readFileSync(SOURCE_FILE, "utf8"))

  assert.equal(plan.version, 1)
  assert.equal(plan.pipelines[0].pipeline, "topCustomers")
  assert.deepEqual(plan.pipelines[0].stages, [
    { type: "source", expression: "customers" },
    { type: "filter", expression: "customer => customer.active" },
    { type: "sortBy", expression: "customer => -customer.spend" },
    { type: "take", args: ["2"] },
    { type: "map", expression: "customer => customer.name" },
    { type: "toArray" }
  ])
})

test("jojo plan prints the same plan, and jojo generate turns it back into a runnable program", async () => {
  const planJson = jojo("plan", SOURCE_FILE, "--format=json")
  assert.deepEqual(JSON.parse(planJson), planPipelines(fs.readFileSync(SOURCE_FILE, "utf8")))

  fs.writeFileSync(PLAN_FILE, planJson)
  const generated = jojo("generate", PLAN_FILE)

  assert.equal(generated, [
    "topCustomers := customers",
    "  |> filter(customer => customer.active)",
    "  |> sortBy(customer => -customer.spend)",
    "  |> take(2)",
    "  |> map(customer => customer.name)",
    "  |> toArray",
    ""
  ].join("\n"))

  const program = `customers := ${JSON.stringify(CUSTOMERS)}\n\n${generated}\nexport { topCustomers }\n`
  fs.writeFileSync(GENERATED_FILE, compile(program, { runtimeImport: "jojoscript/runtime" }))

  const regenerated = await import(pathToFileURL(GENERATED_FILE).href)
  assert.deepEqual(regenerated.topCustomers, topCustomers(CUSTOMERS))
})
