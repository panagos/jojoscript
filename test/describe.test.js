import test from 'node:test'
import assert from 'node:assert/strict'

import { describeSource } from '../src/describe.js'
import { describeSource as exportedDescribeSource } from '../src/index.js'

const SOURCE = `
effect fetchCustomer(id)
effect saveOrder(order)

type Status = Active | Closed(reason)

pure fn isActive(order) = order.status == "active"

effectful fn persist(order)
  requires order.id != null
{
  return saveOrder(order)
}

handle { fetchCustomer: id => ({ id }) } {
  ready := orders |> filter(isActive) @active |> parallel(8) |> map(persist) @save
}

pipeline enrichOrders {
  source orders
  |> map(order => fetchCustomer(order.customerId))
  |> checkpoint("enriched")
}
`

test('describeSource reports the language and description format version', () => {
  const description = describeSource(SOURCE)
  assert.equal(description.language, 'jojo')
  assert.equal(description.version, '1')
})

test('pipelines list their name, inputs, effects, stages, and properties', () => {
  const [ready, enrichOrders] = describeSource(SOURCE).pipelines

  assert.deepEqual(ready, {
    name: 'ready',
    inputs: ['orders'],
    effects: ['persist'],
    stages: [
      { id: 'active', operation: 'filter', expression: 'isActive' },
      { id: 'node-2', operation: 'parallel', concurrency: 8 },
      { id: 'save', operation: 'map', expression: 'persist' }
    ],
    properties: { lazy: true, parallel: true, resumable: false, deterministic: false }
  })

  assert.equal(enrichOrders.name, 'enrichOrders')
  assert.deepEqual(enrichOrders.inputs, ['orders'])
  assert.deepEqual(enrichOrders.effects, ['fetchCustomer'])
  assert.deepEqual(enrichOrders.stages[1], { id: 'node-2', operation: 'checkpoint', name: 'enriched' })
})

test('effects, functions, and types are described with their declarations', () => {
  const description = describeSource(SOURCE)

  assert.deepEqual(description.effects, [
    { name: 'fetchCustomer', params: ['id'], handled: true },
    { name: 'saveOrder', params: ['order'], handled: false }
  ])
  assert.deepEqual(description.functions, [
    { name: 'isActive', line: 7, purity: 'pure', requires: [], ensures: [] },
    { name: 'persist', line: 9, purity: 'effectful', requires: ['order.id != null'], ensures: [] }
  ])
  assert.deepEqual(description.types, [
    { name: 'Status', variants: [{ name: 'Active', fields: [] }, { name: 'Closed', fields: ['reason'] }] }
  ])
})

test('functions with contracts but no purity modifier are described too', () => {
  const [described] = describeSource('fn half(value)\n  ensures result <= value\n{\n  return value / 2\n}\n').functions
  assert.deepEqual(described, { name: 'half', line: 1, purity: null, requires: [], ensures: ['result <= value'] })
})

test('a pipeline with a non-identifier source has no inputs', () => {
  const [pipeline] = describeSource('ids := await loadIds() |> count\n').pipelines
  assert.deepEqual(pipeline.inputs, [])
})

test('describeSource is exported from the compiler entry point', () => {
  assert.equal(exportedDescribeSource, describeSource)
})
