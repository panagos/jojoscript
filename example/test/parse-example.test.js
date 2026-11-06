import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { routeRefunds, Approved, Escalated } from "../dist/application/parse-example.js"

const EXAMPLE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE_FILE = path.join(EXAMPLE_ROOT, "src/application/parse-example.jojo")
const CLI = path.join(EXAMPLE_ROOT, "node_modules/jojoscript/bin/jojo.js")

test("refunds are routed by amount", () => {
  assert.deepEqual(routeRefunds([{ id: 1, amount: 20 }, { id: 2, amount: 900 }]), [
    "1 approved",
    "2 escalated to finance"
  ])
  assert.deepEqual(Approved(1), { tag: "Approved", id: 1 })
  assert.deepEqual(Escalated(2, "finance"), { tag: "Escalated", id: 2, team: "finance" })
})

test("jojo parse lists every construct of the module with its line", () => {
  const parsed = JSON.parse(execFileSync(process.execPath, [CLI, "parse", SOURCE_FILE, "--json"], { encoding: "utf8" }))

  assert.deepEqual(parsed.nodes.map(node => [node.kind, node.name ?? null, node.line]), [
    ["type", "Decision", 6],
    ["function", "decide", 10],
    ["function", "describeDecision", 12],
    ["match", null, 13],
    ["function", "routeRefunds", 19],
    ["pipeline", "routeRefunds", 20]
  ])
  assert.deepEqual(parsed.nodes.find(node => node.kind === "match").patterns, ["Approved(id)", "Escalated(id, team)"])
  assert.equal(parsed.nodes.find(node => node.name === "decide").body, "expression")
})
