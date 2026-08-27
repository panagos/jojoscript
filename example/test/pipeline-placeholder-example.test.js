import test from "node:test"
import assert from "node:assert/strict"

import {
  toPercentageOfTotal,
  subtractFromBudget
} from "../dist/application/pipeline-placeholder-example.js"

test("pipeline without a placeholder still pipes the value as the first argument", () => {
  assert.deepEqual(toPercentageOfTotal([25, 50, 25], 100), [25, 50, 25])
})

test("placeholder argument controls where the piped value is inserted", () => {
  assert.equal(subtractFromBudget(30, 100), 70)
  assert.equal(subtractFromBudget(150, 100), 0)
})
