import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { quoteShipping, describeQuote, sampleQuote, Quoted } from "../dist/application/check-example.js"

const EXAMPLE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE_FILE = path.join(EXAMPLE_ROOT, "src/application/check-example.jojo")
const EDITED_FILE = path.join(EXAMPLE_ROOT, "dist/application/check-example.edited.jojo")
const CLI = path.join(EXAMPLE_ROOT, "node_modules/jojoscript/bin/jojo.js")

function check(file) {
  try {
    return { code: 0, result: JSON.parse(execFileSync(process.execPath, [CLI, "check", file, "--machine"], { encoding: "utf8" })) }
  } catch (error) {
    return { code: error.status, result: JSON.parse(error.stdout) }
  }
}

test("the shipping module quotes and describes shipments", () => {
  assert.deepEqual(quoteShipping(4), Quoted(12))
  assert.equal(describeQuote(quoteShipping(40)), "too heavy to ship")
})

test("jojo check accepts the module as written", () => {
  assert.deepEqual(check(SOURCE_FILE), { code: 0, result: { valid: true, errors: [], warnings: [] } })
})

test("jojo check explains what an LLM edit broke, with codes, lines, and suggestions", () => {
  const edited = fs.readFileSync(SOURCE_FILE, "utf8")
    .replace('    Rejected(reason) => reason\n', "")
    .replace("export fn sampleQuote() = quoteShipping(2)", "export fn sampleQuote() = quoteShipping(-1)")
  fs.writeFileSync(EDITED_FILE, edited)

  const { code, result } = check(EDITED_FILE)

  assert.equal(code, 1)
  assert.equal(result.valid, false)
  assert.deepEqual(result.errors.map(error => error.code), ["E401", "E301"])
  assert.equal(result.errors[0].message, "match on Quote does not handle variant Rejected")
  assert.equal(result.errors[1].message, 'Call quoteShipping(-1) violates "requires weightKg > 0"')
  assert.equal(result.errors[1].suggestion, 'Pass arguments to "quoteShipping" that satisfy weightKg > 0')
})

test("the contract checked statically is also enforced when the module runs", () => {
  assert.equal(describeQuote(sampleQuote()), "ships for 6")
  assert.throws(() => quoteShipping(0), /Contract violated: quoteShipping requires weightKg > 0/)
})
