import test from 'node:test'
import assert from 'node:assert/strict'

import { simulatePipelines, renderSimulationText } from '../src/simulate.js'
import { simulatePipelines as exportedSimulatePipelines } from '../src/index.js'

const SOURCE = `
effect fetchCustomer(id)

pipeline enrichOrders {
  source orders
  |> filter(order => order.paid)
  |> parallel(8)
  |> map(order => fetchCustomer(order.customerId))   @enrich
  |> checkpoint("enriched")
}
`

test('simulate propagates item counts and counts effect calls without running anything', () => {
  const [simulation] = simulatePipelines(SOURCE, { input: 1000000 })

  assert.equal(simulation.name, 'enrichOrders')
  assert.equal(simulation.input, 1000000)
  assert.deepEqual(simulation.stages.map(({ index, id, type, items, exact, workers, effectCalls, checkpoint }) =>
    ({ index, id, type, items, exact, workers, effectCalls, checkpoint })), [
    { index: 1, id: null, type: 'filter', items: 1000000, exact: true, workers: null, effectCalls: {}, checkpoint: null },
    { index: 2, id: null, type: 'parallel', items: 1000000, exact: false, workers: 8, effectCalls: {}, checkpoint: null },
    { index: 3, id: 'enrich', type: 'map', items: 1000000, exact: false, workers: null, effectCalls: { fetchCustomer: 1000000 }, checkpoint: null },
    { index: 4, id: null, type: 'checkpoint', items: 1000000, exact: false, workers: null, effectCalls: {}, checkpoint: 'enriched' }
  ])
  assert.deepEqual(simulation.effectCalls, { fetchCustomer: 1000000 })
  assert.equal(simulation.checkpoints, 1)
})

test('simulate reports effect volume and effects that run before a checkpoint', () => {
  const [simulation] = simulatePipelines(SOURCE, { input: 1000000 })

  assert.deepEqual(simulation.problems, [
    { stage: 3, message: 'up to 1,000,000 calls to effect "fetchCustomer"' },
    { stage: 3, message: 'effect "fetchCustomer" runs before checkpoint "enriched": items processed before a failure are fetched again on retry (at-least-once)' }
  ])
})

test('take, skip, chunk, window, flatMap, and terminal stages change the counts', () => {
  const counts = source => simulatePipelines(source, { input: 100 })[0].stages.map(stage => [stage.type, stage.items])

  assert.deepEqual(counts('r := xs |> skip(10) |> take(50) |> chunk(8) |> count\n'), [
    ['skip', 100], ['take', 90], ['chunk', 50], ['count', 7]
  ])
  assert.deepEqual(counts('r := xs |> window(10) |> flatMap(f) |> map(g) |> first\n'), [
    ['window', 100], ['flatMap', 91], ['map', null], ['first', null]
  ])
  assert.equal(simulatePipelines('r := xs |> take(limit) |> map(f)\n', { input: 5 })[0].stages[1].items, null)
})

test('simulate warns about effectful pipelines without checkpoints and large in-memory sorts', () => {
  const source = 'effectful fn save(row) { return row }\n\nr := rows |> sort |> map(save)\n'
  const [simulation] = simulatePipelines(source, { input: 20000 })

  assert.deepEqual(simulation.problems.map(problem => problem.message), [
    'sort holds all 20,000 items in memory before continuing',
    'up to 20,000 calls to effect "save"',
    'pipeline has effects but no checkpoint: a failure re-runs every effect from the start'
  ])
})

test('a small pure pipeline has no potential problems and defaults to 1,000 records', () => {
  const [simulation] = simulatePipelines('r := xs |> map(x => x * 2) |> toArray\n')
  assert.equal(simulation.input, 1000)
  assert.deepEqual(simulation.problems, [])
})

test('renderSimulationText prints input, operations, and potential problems', () => {
  const text = renderSimulationText(simulatePipelines(SOURCE, { input: 1000000 })[0])

  assert.equal(text, [
    'SIMULATION enrichOrders',
    '',
    'INPUT',
    '  1,000,000 records',
    '',
    'OPERATIONS',
    '  1 filter     1,000,000 items in',
    '  2 parallel   ≤1,000,000 items in, 8 workers',
    '  3 map        ≤1,000,000 items in, ≤1,000,000 calls to fetchCustomer @enrich',
    '  4 checkpoint ≤1,000,000 items in, saved as "enriched"',
    '',
    'POTENTIAL PROBLEMS',
    '  ⚠ stage 3: up to 1,000,000 calls to effect "fetchCustomer"',
    '  ⚠ stage 3: effect "fetchCustomer" runs before checkpoint "enriched": items processed before a failure are fetched again on retry (at-least-once)'
  ].join('\n'))
  assert.match(renderSimulationText(simulatePipelines('r := xs |> flatMap(f) |> map(g)\n')[0]), / {2}2 map {5}unknown items in\n\nPOTENTIAL PROBLEMS\n {2}none$/)
})

test('simulatePipelines is exported from the compiler entry point', () => {
  assert.equal(exportedSimulatePipelines, simulatePipelines)
})
