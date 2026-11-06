import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { onboard } from "../dist/application/why-example.js"
import { ExecutionContext, runInContext, MemoryCheckpointStore } from "jojoscript/runtime"

const EXAMPLE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE_FILE = path.join(EXAMPLE_ROOT, "src/application/why-example.jojo")
const CLI = path.join(EXAMPLE_ROOT, "node_modules/jojoscript/bin/jojo.js")

test("onboarding verifies and welcomes signed-up customers", async () => {
  const ctx = new ExecutionContext({ pipelineId: "onboarding", checkpointStore: new MemoryCheckpointStore() })
  const welcomed = []

  const result = await runInContext(ctx, () => onboard([
    { email: "ada@example.com", signedUp: true },
    { email: "bob@example.com", signedUp: false }
  ], welcomed))

  assert.deepEqual(result, [{ email: "ada@example.com", signedUp: true, verified: true }])
  assert.deepEqual(welcomed, ["ada@example.com"])
})

test("jojo why explains the pipeline's risks in plain language", () => {
  const [why] = JSON.parse(execFileSync(process.execPath, [CLI, "why", SOURCE_FILE, "--format", "json", "--pipeline", "verifiedCustomers"], { encoding: "utf8" }))
  const answers = Object.fromEntries(why.answers.map(({ question, answer }) => [question, answer]))

  assert.equal(answers["Why is this pipeline not deterministic?"],
    "Stage 3 (mapAsync) uses effect verifyEmail; stage 5 (mapAsync) uses effectful function sendWelcome.")
  assert.match(answers["Why can't stage 3 be moved before stage 2?"], /would also run it for items that stage 2 drops/)
  assert.match(answers['Why does checkpoint "verified" not guarantee replay safety?'], /^Effect verifyEmail runs before it \(stage 3\)/)
  assert.match(answers["Why can stage 5 repeat after a failure?"], /after the last checkpoint "verified"/)
})
