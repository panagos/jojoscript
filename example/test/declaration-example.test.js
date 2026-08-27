import test from "node:test"
import assert from "node:assert/strict"

import { declarationExample } from "../dist/application/declaration-example.js"

test("mutable declaration is reassigned from a const value", () => {
  assert.equal(declarationExample(), 10)
})
