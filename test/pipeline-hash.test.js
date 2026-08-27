import test from 'node:test'
import assert from 'node:assert/strict'

import { computePipelineId } from '../src/pipeline-hash.js'

function pipeline(expression, stages) {
  return { expression, stages }
}

test('the same pipeline structure hashes to the same id', () => {
  const a = pipeline('orders', [{ name: 'filter', args: ['o => o.ok'] }])
  const b = pipeline('orders', [{ name: 'filter', args: ['o => o.ok'] }])
  assert.equal(computePipelineId(a), computePipelineId(b))
})

test('whitespace differences do not change the id', () => {
  const a = pipeline('orders', [{ name: 'filter', args: ['o => o.ok'] }])
  const b = pipeline('  orders  ', [{ name: 'filter', args: ['o  =>   o.ok'] }])
  assert.equal(computePipelineId(a), computePipelineId(b))
})

test('a different stage sequence changes the id', () => {
  const a = pipeline('orders', [{ name: 'filter', args: ['o => o.ok'] }])
  const b = pipeline('orders', [{ name: 'map', args: ['o => o.ok'] }])
  assert.notEqual(computePipelineId(a), computePipelineId(b))
})

test('a different argument changes the id', () => {
  const a = pipeline('orders', [{ name: 'take', args: ['10'] }])
  const b = pipeline('orders', [{ name: 'take', args: ['20'] }])
  assert.notEqual(computePipelineId(a), computePipelineId(b))
})

test('a different source expression changes the id', () => {
  const a = pipeline('orders', [])
  const b = pipeline('invoices', [])
  assert.notEqual(computePipelineId(a), computePipelineId(b))
})

test('the id is not random: it is stable across many calls', () => {
  const p = pipeline('orders', [{ name: 'take', args: ['5'] }])
  const ids = new Set(Array.from({ length: 20 }, () => computePipelineId(p)))
  assert.equal(ids.size, 1)
})
