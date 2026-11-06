import test from 'node:test'
import assert from 'node:assert/strict'

import { explainPipelines, renderExplanationText } from '../src/pipeline-explain.js'
import { explainPipelines as exportedExplainPipelines } from '../src/index.js'

const ORDERS_SOURCE = `
effect enrich(order)

paidOrders :=
  orders
    |> filter(order => order.status == "paid")
    |> parallel(8)
    |> map(enrich)
    |> checkpoint("enriched")
`

test('explainPipelines names a pipeline after the variable it is assigned to', () => {
  const [explanation] = explainPipelines(ORDERS_SOURCE)
  assert.equal(explanation.name, 'paidOrders')
  assert.match(explanation.id, /^[0-9a-f]{16}$/)
})

test('explainPipelines describes every stage with its role', () => {
  const [explanation] = explainPipelines(ORDERS_SOURCE)

  assert.deepEqual(
    explanation.stages.map(({ index, type, detail }) => ({ index, type, detail })),
    [
      { index: 1, type: 'source', detail: 'orders' },
      { index: 2, type: 'filter', detail: 'pure' },
      { index: 3, type: 'parallel', detail: 'concurrency=8' },
      { index: 4, type: 'map', detail: 'effectful: enrich' },
      { index: 5, type: 'checkpoint', detail: 'enriched' }
    ]
  )
  assert.deepEqual(explanation.stages[3].effects, ['enrich'])
  assert.deepEqual(explanation.stages[1].args, ['order => order.status == "paid"'])
})

test('explainPipelines lists referenced effects with their static handler signal', () => {
  const handled = `
effect fetchUser(id)
effect saveUser(user)

handle { fetchUser: id => ({ id }) } {
  users |> map(fetchUser) |> map(saveUser) |> map(fetchUser)
}
`
  const [explanation] = explainPipelines(handled)
  assert.deepEqual(explanation.effects, [
    { name: 'fetchUser', staticallyHandled: true },
    { name: 'saveUser', staticallyHandled: false }
  ])
})

test('explainPipelines derives lazy, parallel, resumable, and deterministic properties', () => {
  const [orders] = explainPipelines(ORDERS_SOURCE)
  assert.deepEqual(orders.properties, {
    lazy: true,
    parallel: true,
    resumable: true,
    deterministic: false
  })

  const [sorted] = explainPipelines('names := users |> map(user => user.name) |> sort\n')
  assert.deepEqual(sorted.properties, {
    lazy: false,
    parallel: false,
    resumable: false,
    deterministic: true
  })
})

test('explainPipelines marks compile-time control stages as control', () => {
  const [explanation] = explainPipelines('result := load() |> orElse([]) |> await\n')
  assert.deepEqual(explanation.stages.slice(1).map(stage => stage.detail), ['control', 'control'])
})

test('explainPipelines describes batch sizes', () => {
  const [explanation] = explainPipelines('groups := rows |> batch(100)\n')
  assert.equal(explanation.stages[1].detail, 'size=100')
})

test('explainPipelines infers names from declarations, expression functions, properties, and enclosing functions', () => {
  const source = `
mutable counter := items |> count

export const total = prices |> reduce((sum, price) => sum + price, 0)

fn doubled(values) = values |> map(value => value * 2)

async fn loadUsers(ids) {
  return ids |> mapAsync(fetchUser) |> toArrayAsync |> await
}

report := { size: rows |> count }

console.log(values |> count)
`
  assert.deepEqual(
    explainPipelines(source).map(explanation => explanation.name),
    ['counter', 'total', 'doubled', 'loadUsers', 'size', 'pipeline-6']
  )
})

test('explainPipelines does not name a return pipeline after an already closed function', () => {
  const source = `
fn first() {
  return 1
}

const later = function () {
  return ids |> count
}
`
  const [explanation] = explainPipelines(source)
  assert.equal(explanation.name, 'pipeline-1')
})

test('renderExplanationText prints PIPELINE, STAGES, EFFECTS, and PROPERTIES sections', () => {
  const [explanation] = explainPipelines(ORDERS_SOURCE)

  assert.equal(renderExplanationText(explanation), [
    'PIPELINE paidOrders',
    '',
    'STAGES',
    '  1 source     orders',
    '  2 filter     pure',
    '  3 parallel   concurrency=8',
    '  4 map        effectful: enrich',
    '  5 checkpoint enriched',
    '',
    'EFFECTS',
    '  enrich (no handler in file)',
    '',
    'PROPERTIES',
    '  lazy: true',
    '  parallel: true',
    '  resumable: true',
    '  deterministic: false'
  ].join('\n'))
})

test('renderExplanationText reports pipelines without effects', () => {
  const [explanation] = explainPipelines('names := users |> map(user => user.name)\n')
  assert.match(renderExplanationText(explanation), /EFFECTS\n {2}none\n/)
})

test('explainPipelines is exported from the compiler entry point', () => {
  assert.equal(exportedExplainPipelines, explainPipelines)
})
