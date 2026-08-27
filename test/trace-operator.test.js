import test from 'node:test'
import assert from 'node:assert/strict'

import { traceNode } from '../src/runtime/trace.js'
import { ExecutionContext, runInContext } from '../src/runtime/execution-context.js'

test('traceNode returns eager values (arrays) completely unchanged', () => {
  const ctx = new ExecutionContext()
  const array = [1, 2, 3]
  const result = runInContext(ctx, () => traceNode(array, { id: 'node-1', type: 'sort' }))
  assert.equal(result, array) // same reference, not a copy/wrapper
})

test('traceNode records the length of an eager array result', () => {
  const ctx = new ExecutionContext()
  runInContext(ctx, () => traceNode([1, 2, 3, 4], { id: 'node-1', type: 'sort' }))
  const [node] = ctx.metrics.toJSON().nodes
  assert.equal(node.items, 4)
  assert.equal(node.type, 'sort')
})

test('traceNode records Map/Set sizes without changing their type', () => {
  const ctx = new ExecutionContext()
  const map = new Map([['a', 1], ['b', 2]])
  const result = runInContext(ctx, () => traceNode(map, { id: 'node-1', type: 'groupBy' }))
  assert.equal(result, map)
  assert.equal(ctx.metrics.toJSON().nodes[0].items, 2)
})

test('traceNode records scalar results as a single item', () => {
  const ctx = new ExecutionContext()
  const result = runInContext(ctx, () => traceNode(42, { id: 'node-1', type: 'count' }))
  assert.equal(result, 42)
  assert.equal(ctx.metrics.toJSON().nodes[0].items, 1)
})

test('traceNode wraps a lazy sync generator without eagerly consuming it', () => {
  const ctx = new ExecutionContext()
  let pulled = 0
  function* source() {
    for (let i = 0; i < 3; i++) {
      pulled++
      yield i
    }
  }

  const wrapped = runInContext(ctx, () => traceNode(source(), { id: 'node-1', type: 'map' }))
  assert.equal(pulled, 0)

  const result = [...wrapped]
  assert.deepEqual(result, [0, 1, 2])
  assert.equal(pulled, 3)
  assert.equal(ctx.metrics.toJSON().nodes[0].items, 3)
})

test('traceNode wraps a lazy async generator without eagerly consuming it', async () => {
  const ctx = new ExecutionContext()
  async function* source() {
    yield 1
    yield 2
  }

  const wrapped = runInContext(ctx, () => traceNode(source(), { id: 'node-1', type: 'mapAsync' }))

  const result = []
  for await (const item of wrapped) result.push(item)

  assert.deepEqual(result, [1, 2])
  assert.equal(ctx.metrics.toJSON().nodes[0].items, 2)
})

test('traceNode accumulates multiple calls into the same node id', () => {
  const ctx = new ExecutionContext()
  runInContext(ctx, () => traceNode([1, 2], { id: 'node-1', type: 'map' }))
  runInContext(ctx, () => traceNode([1, 2, 3], { id: 'node-1', type: 'map' }))
  const [node] = ctx.metrics.toJSON().nodes
  assert.equal(node.items, 5)
})
