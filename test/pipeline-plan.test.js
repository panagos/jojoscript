import test from 'node:test'
import assert from 'node:assert/strict'

import { planPipelines, planToJojo } from '../src/pipeline-plan.js'
import { planPipelines as exportedPlanPipelines, planToJojo as exportedPlanToJojo } from '../src/index.js'

const ORDERS_SOURCE = `
paidOrders :=
  orders
    |> filter(order => order.status == "paid")
    |> parallel(8)
    |> map(enrich)
    |> checkpoint('enriched')
    |> take(10)
    |> toArrayAsync
`

test('planPipelines produces a versioned plan with one entry per pipeline', () => {
  const plan = planPipelines(ORDERS_SOURCE)
  assert.equal(plan.version, 1)
  assert.equal(plan.pipelines.length, 1)
  assert.equal(plan.pipelines[0].pipeline, 'paidOrders')
  assert.match(plan.pipelines[0].id, /^[0-9a-f]{16}$/)
})

test('planPipelines gives well-known stages typed fields and other stages raw args', () => {
  const [{ stages }] = planPipelines(ORDERS_SOURCE).pipelines

  assert.deepEqual(stages, [
    { type: 'source', expression: 'orders' },
    { type: 'filter', expression: 'order => order.status == "paid"' },
    { type: 'parallel', concurrency: 8 },
    { type: 'map', expression: 'enrich' },
    { type: 'checkpoint', name: 'enriched' },
    { type: 'take', args: ['10'] },
    { type: 'toArrayAsync' }
  ])
})

test('planPipelines keeps non-literal settings as args so the plan stays lossless', () => {
  const [{ stages }] = planPipelines('result := rows |> parallel(limit) |> batch(size) |> checkpoint(label)\n').pipelines

  assert.deepEqual(stages.slice(1), [
    { type: 'parallel', args: ['limit'] },
    { type: 'batch', args: ['size'] },
    { type: 'checkpoint', args: ['label'] }
  ])
})

test('planPipelines distinguishes property reads from property calls', () => {
  const [{ stages }] = planPipelines('result := name |> .trim() |> .padStart(4, "0") |> .length\n').pipelines

  assert.deepEqual(stages.slice(1), [
    { type: '.trim', args: [] },
    { type: '.padStart', args: ['4', '"0"'] },
    { type: '.length' }
  ])
})

test('planPipelines records batch sizes and leaves unnamed pipelines with a null name', () => {
  const plan = planPipelines('console.log(rows |> batch(100) |> count)\n')
  assert.equal(plan.pipelines[0].pipeline, null)
  assert.deepEqual(plan.pipelines[0].stages[1], { type: 'batch', size: 100 })
})

test('planPipelines returns an empty plan when the source has no pipelines', () => {
  assert.deepEqual(planPipelines('x := 1\n'), { version: 1, pipelines: [] })
})

test('planToJojo turns a plan back into a JojoScript program', () => {
  assert.equal(planToJojo(planPipelines(ORDERS_SOURCE)), [
    'paidOrders := orders',
    '  |> filter(order => order.status == "paid")',
    '  |> parallel(8)',
    '  |> map(enrich)',
    '  |> checkpoint("enriched")',
    '  |> take(10)',
    '  |> toArrayAsync',
    ''
  ].join('\n'))
})

test('planToJojo round-trips property stages, raw args, and unnamed pipelines', () => {
  const source = [
    'label := name |> .trim() |> .padStart(4, "0") |> .length',
    '',
    'rows |> parallel(limit) |> divide(100, _)',
    ''
  ].join('\n')

  const generated = planToJojo(planPipelines(source))
  assert.deepEqual(planPipelines(generated).pipelines.map(({ stages }) => stages), planPipelines(source).pipelines.map(({ stages }) => stages))
  assert.match(generated, /\n\nrows\n {2}\|> parallel\(limit\)/)
})

function invalid(plan, message) {
  assert.throws(() => planToJojo(plan), error => {
    assert.equal(error.name, 'PlanValidationError')
    assert.equal(error.message, `Invalid plan: ${message}`)
    return true
  })
}

const source = { type: 'source', expression: 'orders' }
const withStages = (...stages) => ({ version: 1, pipelines: [{ pipeline: 'result', stages: [source, ...stages] }] })

test('planToJojo rejects plans with an unsupported shape or version', () => {
  invalid(null, 'plan must be an object')
  invalid({ version: 2, pipelines: [] }, 'version must be 1')
  invalid({ version: 1 }, 'pipelines must be an array')
  invalid({ version: 1, pipelines: [], extra: true }, 'unknown field "extra"')
})

test('planToJojo rejects invalid pipeline names and missing sources', () => {
  invalid({ version: 1, pipelines: [{ pipeline: 'my-orders', stages: [source] }] },
    'pipelines[0].pipeline must be an identifier or null')
  invalid({ version: 1, pipelines: [{ pipeline: 'a', stages: [source] }, { pipeline: 'a', stages: [source] }] },
    'pipelines[1].pipeline "a" is already declared')
  invalid({ version: 1, pipelines: [{ pipeline: 'a', stages: [] }] },
    'pipelines[0].stages must be a non-empty array')
  invalid({ version: 1, pipelines: [{ pipeline: 'a', stages: [{ type: 'map', expression: 'f' }] }] },
    'pipelines[0].stages[0] must be a source stage')
  invalid({ version: 1, pipelines: [{ pipeline: 'a', stages: [{ type: 'source', expression: ' ' }] }] },
    'pipelines[0].stages[0].expression must be a non-empty string')
})

test('planToJojo rejects malformed stages with the path of the offending field', () => {
  invalid(withStages({ type: 'parallel', concurrency: 0 }), 'pipelines[0].stages[1].concurrency must be a positive integer')
  invalid(withStages({ type: 'batch', size: 1.5 }), 'pipelines[0].stages[1].size must be a positive integer')
  invalid(withStages({ type: 'checkpoint', name: '' }), 'pipelines[0].stages[1].name must be a non-empty string')
  invalid(withStages({ type: 'map', expression: 42 }), 'pipelines[0].stages[1].expression must be a non-empty string')
  invalid(withStages({ type: 'take', args: [10] }), 'pipelines[0].stages[1].args must be an array of non-empty strings')
  invalid(withStages({ type: 'map(f)' }), 'pipelines[0].stages[1].type must be a stage name such as "map" or ".trim"')
  invalid(withStages({ type: 'source', expression: 'more' }), 'pipelines[0].stages[1] must not be a source stage')
  invalid(withStages({ type: 'take', concurrency: 2 }), 'pipelines[0].stages[1] has unknown field "concurrency"')
  invalid(withStages({ type: 'map', expression: 'f', args: ['g'] }), 'pipelines[0].stages[1] must use only one of "expression" or "args"')
})

test('planToJojo rejects plans whose generated program is not valid', () => {
  invalid(withStages({ type: 'map', expression: 'value =>' }),
    'pipelines[0] does not compile to valid JavaScript (Unexpected token \')\')')
})

test('planPipelines and planToJojo are exported from the compiler entry point', () => {
  assert.equal(exportedPlanPipelines, planPipelines)
  assert.equal(exportedPlanToJojo, planToJojo)
})
