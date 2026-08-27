import test from 'node:test'
import assert from 'node:assert/strict'

import { Metrics, throughputOf } from '../src/runtime/metrics.js'

test('throughputOf computes items per second', () => {
  assert.equal(throughputOf(1000, 2000), 500)
})

test('throughputOf falls back to the raw item count for zero duration', () => {
  assert.equal(throughputOf(10, 0), 10)
})

test('Metrics.record accumulates items and duration per node id', () => {
  const metrics = new Metrics()
  metrics.record('node-1', 'map', 10, 100)
  metrics.record('node-1', 'map', 5, 50)

  const [node] = metrics.toJSON().nodes
  assert.equal(node.id, 'node-1')
  assert.equal(node.type, 'map')
  assert.equal(node.items, 15)
  assert.equal(node.durationMs, 150)
  assert.ok(node.throughput > 0)
})

test('Metrics.record ignores calls with no node id', () => {
  const metrics = new Metrics()
  metrics.record(undefined, 'map', 10, 100)
  assert.equal(metrics.toJSON().nodes.length, 0)
})

test('Metrics tracks multiple distinct nodes independently', () => {
  const metrics = new Metrics()
  metrics.record('node-1', 'filter', 10, 100)
  metrics.record('node-2', 'map', 5, 50)

  const nodes = metrics.toJSON().nodes
  assert.equal(nodes.length, 2)
  assert.deepEqual(nodes.map(n => n.id).sort(), ['node-1', 'node-2'])
})

test('Metrics.recordInspect stores inspection reports in order', () => {
  const metrics = new Metrics()
  metrics.recordInspect('a', { label: 'a', items: 1 })
  metrics.recordInspect('b', { label: 'b', items: 2 })

  assert.deepEqual(metrics.toJSON().inspections.map(r => r.label), ['a', 'b'])
})
