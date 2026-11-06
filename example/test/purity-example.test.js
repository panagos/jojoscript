import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { normalizeUser, importUsers } from "../dist/application/purity-example.js"
import { compile, explainPipelines } from "jojoscript"

const SOURCE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/application/purity-example.jojo")

test("the pure normalizer and the effectful saver run as ordinary functions", async () => {
  const saved = []

  const imported = await importUsers([{ id: 1, email: "  Ada@Example.COM " }], saved)

  assert.deepEqual(normalizeUser({ id: 2, email: " X@Y.Z" }), { id: 2, email: "x@y.z" })
  assert.deepEqual(imported, [{ id: 1, email: "ada@example.com" }])
  assert.deepEqual(saved, [{ id: 1, email: "ada@example.com" }])
})

test("explain reports the normalizing stage as pure and the saving stage as effectful", () => {
  const [explanation] = explainPipelines(fs.readFileSync(SOURCE_FILE, "utf8"))

  assert.deepEqual(explanation.stages.slice(1, 3).map(stage => stage.detail), ["pure", "effectful: saveUser"])
  assert.equal(explanation.properties.deterministic, false)
})

test("the compiler rejects a pure function that saves users", () => {
  const source = fs.readFileSync(SOURCE_FILE, "utf8")
    .replace("return { ...user, email:", "saveUser(user)\n  return { ...user, email:")

  assert.throws(() => compile(source), /pure fn "normalizeUser" uses effectful function "saveUser" \(line 9\)/)
})
