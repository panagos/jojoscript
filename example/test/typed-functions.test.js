import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  add,
  formatPrice,
  isAdult,
  loadUserName
} from "../dist/application/typed-functions.js"

const distDir = path.dirname(fileURLToPath(import.meta.url))
const compiledSource = fs.readFileSync(
  path.join(distDir, "..", "dist", "application", "typed-functions.js"),
  "utf8"
)

test("typed function behaves like an ordinary function at runtime", () => {
  assert.equal(add(2, 3), 5)
})

test("typed function with a default parameter", () => {
  assert.equal(formatPrice(9.5), "USD 9.50")
  assert.equal(formatPrice(9.5, "EUR"), "EUR 9.50")
})

test("typed boolean-returning function", () => {
  assert.equal(isAdult(20), true)
  assert.equal(isAdult(10), false)
})

test("async typed function", async () => {
  const repository = { findById: async () => ({ name: "Ada" }) }
  assert.equal(await loadUserName(1, repository), "Ada")
})

test("compiled output documents parameter and return types as JSDoc", () => {
  assert.match(compiledSource, /@param \{number\} a/)
  assert.match(compiledSource, /@param \{number\} b/)
  assert.match(compiledSource, /@returns \{number\}/)
  assert.match(compiledSource, /@returns \{Promise<string>\}/)
  assert.ok(!compiledSource.includes(": number"))
})
