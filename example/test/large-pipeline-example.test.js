import test from "node:test"
import assert from "node:assert/strict"

import { buildLargePipelineReport } from "../dist/application/large-pipeline-example.js"

test("large pipeline composes more than twenty stages and preserves the input", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  const result = buildLargePipelineReport(values)

  assert.equal(result, 1)
  assert.deepEqual(values, [1, 2, 3, 4, 5, 6, 7, 8, 9])
})
