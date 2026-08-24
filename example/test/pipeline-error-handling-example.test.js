import test from "node:test"
import assert from "node:assert/strict"

import {
  parseConfigValue,
  safeDivide
} from "../dist/application/pipeline-error-handling-example.js"

test("orElse returns the fallback when the pipeline throws", () => {
  assert.equal(parseConfigValue("not json"), null)
})

test("orElse is bypassed when the pipeline succeeds", () => {
  assert.deepEqual(parseConfigValue('{"a":1}'), { a: 1 })
})

test("catch calls the handler with the error when the pipeline throws", () => {
  assert.deepEqual(safeDivide(1, 0), { error: "Division by zero" })
})

test("catch is bypassed when the pipeline succeeds", () => {
  assert.equal(safeDivide(10, 2), 5)
})
