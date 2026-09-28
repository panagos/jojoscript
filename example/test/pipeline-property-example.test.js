import test from "node:test"
import assert from "node:assert/strict"

import {
  labelLength,
  headline
} from "../dist/application/pipeline-property-example.js"

test("property-access pipeline stages read fields and invoke methods on the piped value", () => {
  assert.equal(labelLength("  hello world  "), 11)
  assert.equal(headline("  hello world  "), "HELLO WORLD")
})
