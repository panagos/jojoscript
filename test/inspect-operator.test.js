import test from 'node:test'
import assert from 'node:assert/strict'

import { inspect, formatInspectReport } from '../src/runtime/inspect.js'
import { ExecutionContext, runInContext } from '../src/runtime/execution-context.js'

async function collect(iterable) {
  const result = []
  for await (const item of iterable) result.push(item)
  return result
}

test('inspect passes every item through unchanged', async () => {
  const ctx = new ExecutionContext({ quiet: true })
  const result = await runInContext(ctx, () => collect(inspect([1, 2, 3], 'label')))
  assert.deepEqual(result, [1, 2, 3])
})

test('inspect is lazy: nothing runs before the first pull', async () => {
  let started = false
  function* source() {
    started = true
    yield 1
  }

  const ctx = new ExecutionContext({ quiet: true })
  const stream = runInContext(ctx, () => inspect(source(), 'label'))
  assert.equal(started, false)

  await runInContext(ctx, () => collect(stream))
  assert.equal(started, true)
})

test('inspect records item count and timing into the execution context metrics', async () => {
  const ctx = new ExecutionContext({ quiet: true })
  await runInContext(ctx, () => collect(inspect([1, 2, 3, 4], 'my-stage')))

  assert.equal(ctx.metrics.inspections.length, 1)
  const [report] = ctx.metrics.inspections
  assert.equal(report.label, 'my-stage')
  assert.equal(report.items, 4)
  assert.equal(report.failed, 0)
  assert.ok(report.durationMs >= 0)
  assert.ok(report.throughput >= 0)
  assert.ok(report.startedAt)
  assert.ok(report.endedAt)
})

test('inspect re-throws upstream errors and still records what got through', async () => {
  const ctx = new ExecutionContext({ quiet: true })

  async function* source() {
    yield 1
    yield 2
    throw new Error('boom')
  }

  await assert.rejects(
    () => runInContext(ctx, () => collect(inspect(source(), 'flaky'))),
    /boom/
  )

  const [report] = ctx.metrics.inspections
  assert.equal(report.items, 2)
  assert.equal(report.failed, 1)
})

test('formatInspectReport renders the items/throughput/duration summary', () => {
  const text = formatInspectReport({
    label: 'paid-orders',
    items: 182391,
    throughput: 12421,
    durationMs: 14680
  })

  assert.match(text, /^paid-orders/)
  assert.match(text, /items:\s+182391/)
  assert.match(text, /throughput:\s+12421\/s/)
  assert.match(text, /duration:\s+14\.68s/)
})
