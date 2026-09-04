import test from 'node:test'
import assert from 'node:assert/strict'

import { analyzePipelines, buildGraph, renderGraphText, renderGraphDot } from '../src/pipeline-ir.js'

const SOURCE = `
effect fetchUser(id)
effect saveUser(user)

users
  |> map(user => fetchUser(user.id))
  |> parallel(8)
  |> map(saveUser)
`

test('analyzePipelines exposes which nodes reference a declared effect', () => {
  const [graph] = analyzePipelines(SOURCE)
  const [, mapFetch, parallelNode, mapSave] = graph.nodes

  assert.deepEqual(mapFetch.metadata.effects, ['fetchUser'])
  assert.deepEqual(parallelNode.metadata.effects, undefined)
  assert.deepEqual(mapSave.metadata.effects, ['saveUser'])
})

test('graph.effects summarizes effect name, node id, and static handled status', () => {
  const [graph] = analyzePipelines(SOURCE)

  assert.deepEqual(graph.effects, [
    { name: 'fetchUser', nodeId: 'node-1', staticallyHandled: false },
    { name: 'saveUser', nodeId: 'node-3', staticallyHandled: false }
  ])
})

test('a handle block naming the effect marks it staticallyHandled: true', () => {
  const source = `
effect fetchUser(id)

handle {
  fetchUser: id => ({ id })
} {
  users |> map(user => fetchUser(user.id))
}
`
  const [graph] = analyzePipelines(source)
  assert.deepEqual(graph.effects, [
    { name: 'fetchUser', nodeId: 'node-1', staticallyHandled: true }
  ])
})

test('a bare effect reference as a pipeline stage (not just inside a lambda) is detected too', () => {
  const source = `
effect saveUser(user)

users |> map(saveUser)
`
  const [graph] = analyzePipelines(source)
  assert.deepEqual(graph.effects.map(e => e.name), ['saveUser'])
})

test('renderGraphText annotates nodes that use an effect', () => {
  const [graph] = analyzePipelines(SOURCE)
  const text = renderGraphText(graph)
  assert.match(text, /MAP user => fetchUser\(user\.id\) {2}\[effects: fetchUser\]/)
  assert.match(text, /MAP saveUser {2}\[effects: saveUser\]/)
  assert.doesNotMatch(text, /PARALLEL.*\[effects/)
})

test('renderGraphDot annotates nodes that use an effect', () => {
  const [graph] = analyzePipelines(SOURCE)
  const dot = renderGraphDot(graph)
  assert.match(dot, /\[effects: fetchUser\]/)
  assert.match(dot, /\[effects: saveUser\]/)
})

test('a pipeline with no declared effects has empty graph.effects (backwards compatible)', () => {
  const [graph] = analyzePipelines('orders |> filter(o => o.ok) |> take(5)\n')
  assert.deepEqual(graph.effects, [])
  assert.equal(graph.nodes[1].metadata.effects, undefined)
})

test('buildGraph still works with no options argument at all', () => {
  const graph = buildGraph({ expression: 'x', stages: [] })
  assert.deepEqual(graph.effects, [])
})
