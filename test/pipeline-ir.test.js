import test from 'node:test'
import assert from 'node:assert/strict'

import {
  analyzePipelines,
  buildGraph,
  renderGraphText,
  renderGraphDot
} from '../src/pipeline-ir.js'

const SOURCE = `
orders
  |> filter(o => o.status == "paid")
  |> map(o => calculate(o))
  |> take(100)
`

test('analyzePipelines finds one graph per pipeline statement', () => {
  const [pipeline] = analyzePipelines(SOURCE)
  assert.equal(pipeline.expression, 'orders')
  assert.equal(pipeline.nodes.length, 5) // source + filter + map + take + result
})

test('graph nodes chain via dependencies in stage order', () => {
  const [pipeline] = analyzePipelines(SOURCE)
  const [source, filterNode, mapNode, takeNode, result] = pipeline.nodes

  assert.equal(source.type, 'source')
  assert.deepEqual(source.dependencies, [])

  assert.equal(filterNode.type, 'filter')
  assert.deepEqual(filterNode.dependencies, [source.id])

  assert.equal(mapNode.type, 'map')
  assert.deepEqual(mapNode.dependencies, [filterNode.id])

  assert.equal(takeNode.type, 'take')
  assert.deepEqual(takeNode.dependencies, [mapNode.id])

  assert.equal(result.type, 'result')
  assert.deepEqual(result.dependencies, [takeNode.id])
})

test('node ids are stable node-<n> identifiers', () => {
  const [pipeline] = analyzePipelines(SOURCE)
  assert.deepEqual(pipeline.nodes.map(n => n.id), ['node-0', 'node-1', 'node-2', 'node-3', 'node-4'])
})

test('analyzePipelines finds multiple pipeline statements in one file', () => {
  const multi = `
a |> map(f)
b |> filter(g)
`
  const pipelines = analyzePipelines(multi)
  assert.equal(pipelines.length, 2)
  assert.equal(pipelines[0].expression, 'a')
  assert.equal(pipelines[1].expression, 'b')
})

test('renderGraphText renders SOURCE/.../RESULT with arrows', () => {
  const [pipeline] = analyzePipelines(SOURCE)
  const text = renderGraphText(pipeline)
  assert.match(text, /^SOURCE orders/)
  assert.match(text, /FILTER o => o\.status == "paid"/)
  assert.match(text, /MAP o => calculate\(o\)/)
  assert.match(text, /TAKE 100/)
  assert.match(text, /RESULT$/)
  assert.match(text, /│\n {6}▼/)
})

test('renderGraphDot renders a valid-looking digraph', () => {
  const [pipeline] = analyzePipelines(SOURCE)
  const dot = renderGraphDot(pipeline)
  assert.match(dot, /^digraph pipeline \{/)
  assert.match(dot, /"node-0" -> "node-1";/)
  assert.match(dot, /\}$/)
})

test('buildGraph accepts an explicit pipeline id', () => {
  const graph = buildGraph({ expression: 'x', stages: [] }, 'fixed-id')
  assert.equal(graph.id, 'fixed-id')
  assert.equal(graph.nodes.length, 2) // source + result, no stages
})

test('analyzePipelines returns an empty array when there are no pipelines', () => {
  assert.deepEqual(analyzePipelines('x := 1\nconsole.log(x)\n'), [])
})
