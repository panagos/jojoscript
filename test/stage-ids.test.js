import test from 'node:test'
import assert from 'node:assert/strict'

import { compile } from '../src/compiler.js'
import { analyzePipelines } from '../src/pipeline-ir.js'
import { explainPipelines, renderExplanationText } from '../src/pipeline-explain.js'
import { planPipelines, planToJojo } from '../src/pipeline-plan.js'

const SOURCE = `
saved := orders
  |> filter(order => order.active)   @filter-active
  |> parallel(8)                      @parallel
  |> map(enrich)                      @enrich
  |> checkpoint("enriched")
`

test('stage ids are removed from the compiled code and used as node ids in runtime metadata', () => {
  const output = compile(SOURCE)

  assert.doesNotMatch(output, /@filter-active|@enrich/)
  assert.match(output, /"id":"parallel","pipelineId":"[0-9a-f]{16}","type":"parallel"/)
  assert.match(output, /"id":"node-4","pipelineId":"[0-9a-f]{16}","type":"checkpoint"/)
  assert.match(output, /map\(parallel\(filter\(orders, order => order\.active\)/)
})

test('profiled stages report their explicit ids', () => {
  assert.match(compile(SOURCE, { profile: true }), /"id":"enrich","pipelineId":"[0-9a-f]{16}","type":"map"/)
})

test('stage ids do not change the pipeline id, so renaming them keeps saved checkpoints', () => {
  const [withIds] = analyzePipelines(SOURCE)
  const [withoutIds] = analyzePipelines(SOURCE.replace(/ +@[\w-]+/g, ''))
  assert.equal(withIds.id, withoutIds.id)
})

test('the graph uses stage ids as node ids and dependencies', () => {
  const [graph] = analyzePipelines(SOURCE)

  assert.deepEqual(graph.nodes.map(node => [node.id, node.dependencies]), [
    ['node-0', []],
    ['filter-active', ['node-0']],
    ['parallel', ['filter-active']],
    ['enrich', ['parallel']],
    ['node-4', ['enrich']],
    ['node-5', ['node-4']]
  ])
})

test('explain reports stage ids', () => {
  const [explanation] = explainPipelines(SOURCE)

  assert.deepEqual(explanation.stages.map(stage => stage.id), [null, 'filter-active', 'parallel', 'enrich', null])
  assert.match(renderExplanationText(explanation), / {2}4 map {8}pure @enrich\n {2}5 checkpoint enriched\n/)
})

test('plans carry stage ids and generate writes them back', () => {
  const plan = planPipelines(SOURCE)

  assert.deepEqual(plan.pipelines[0].stages[3], { type: 'map', expression: 'enrich', id: 'enrich' })
  assert.match(planToJojo(plan), / {2}\|> map\(enrich\) @enrich\n/)
  assert.deepEqual(planPipelines(planToJojo(plan)).pipelines[0].stages, plan.pipelines[0].stages)
})

test('generate validates stage ids', () => {
  const plan = stages => ({ version: 1, pipelines: [{ pipeline: 'p', stages: [{ type: 'source', expression: 'xs' }, ...stages] }] })

  assert.throws(() => planToJojo(plan([{ type: 'count', id: 'bad id' }])),
    /pipelines\[0\]\.stages\[1\]\.id must be a stage id such as "enrich"/)
  assert.throws(() => planToJojo(plan([{ type: 'count', id: 'a' }, { type: 'first', id: 'a' }])),
    /pipelines\[0\]\.stages\[2\]\.id "a" is already used in this pipeline/)
})

test('invalid and duplicate stage ids are compile errors', () => {
  assert.throws(() => compile('r := xs |> count @9lives\n'), /Invalid stage id: @9lives/)
  assert.throws(() => compile('r := xs |> map(f) @step |> map(g) @step\n'), /Duplicate stage id: @step/)
})
