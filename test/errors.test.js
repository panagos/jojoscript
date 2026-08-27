import test from 'node:test'
import assert from 'node:assert/strict'

import { PipelineError, NonRetryableError } from '../src/runtime/errors.js'

test('NonRetryableError sets name and retryable = false', () => {
  const error = new NonRetryableError('nope')
  assert.equal(error.name, 'NonRetryableError')
  assert.equal(error.retryable, false)
  assert.ok(error instanceof Error)
  assert.equal(error.message, 'nope')
})

test('PipelineError carries structured pipeline failure details', () => {
  const cause = new Error('root cause')
  const error = new PipelineError('Connection timeout', {
    pipelineId: 'p1',
    nodeId: 'node-8',
    operation: 'fetchProfile',
    itemIndex: 182391,
    retryCount: 3,
    cause
  })

  assert.equal(error.name, 'PipelineError')
  assert.equal(error.message, 'Connection timeout')
  assert.equal(error.pipelineId, 'p1')
  assert.equal(error.nodeId, 'node-8')
  assert.equal(error.operation, 'fetchProfile')
  assert.equal(error.itemIndex, 182391)
  assert.equal(error.retryCount, 3)
  assert.equal(error.cause, cause)
  assert.ok(error.timestamp)
})

test('PipelineError fills in sensible defaults when details are omitted', () => {
  const error = new PipelineError('failed')
  assert.equal(error.pipelineId, null)
  assert.equal(error.nodeId, null)
  assert.equal(error.operation, null)
  assert.equal(error.itemIndex, null)
  assert.equal(error.retryCount, 0)
  assert.ok(error.timestamp)
})
