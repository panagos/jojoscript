import test from 'node:test'
import assert from 'node:assert/strict'

import { summarize } from './dist/dataflow-example.js'

test('summarize filters and scales even values', async () => {
  assert.deepEqual(await summarize([1, 2, 3, 4, 5, 6]), [20, 40, 60])
})
