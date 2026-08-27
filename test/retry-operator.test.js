import test from 'node:test'
import assert from 'node:assert/strict'

import { retry } from '../src/runtime/retry.js'
import { NonRetryableError } from '../src/runtime/errors.js'

test('retry returns the result on first success without retrying', async () => {
  let calls = 0
  const wrapped = retry(async () => { calls++; return 'ok' }, { attempts: 3 })
  assert.equal(await wrapped(), 'ok')
  assert.equal(calls, 1)
})

test('retry retries up to the configured number of attempts', async () => {
  let calls = 0
  const wrapped = retry(async () => {
    calls++
    if (calls < 3) throw new Error(`fail ${calls}`)
    return 'ok'
  }, { attempts: 5, delay: 0 })

  assert.equal(await wrapped(), 'ok')
  assert.equal(calls, 3)
})

test('retry propagates the last error once attempts are exhausted', async () => {
  let calls = 0
  const wrapped = retry(async () => { calls++; throw new Error('always fails') }, { attempts: 3, delay: 0 })

  await assert.rejects(() => wrapped(), /always fails/)
  assert.equal(calls, 3)
})

test('retry defaults to a single attempt (no retrying) when no options are given', async () => {
  let calls = 0
  const wrapped = retry(async () => { calls++; throw new Error('nope') })
  await assert.rejects(() => wrapped(), /nope/)
  assert.equal(calls, 1)
})

test('retry never retries a NonRetryableError', async () => {
  let calls = 0
  const wrapped = retry(async () => { calls++; throw new NonRetryableError('stop') }, { attempts: 5 })
  await assert.rejects(() => wrapped(), /stop/)
  assert.equal(calls, 1)
})

test('retry never retries any error explicitly marked retryable: false', async () => {
  let calls = 0
  const wrapped = retry(async () => {
    calls++
    const error = new Error('do not retry')
    error.retryable = false
    throw error
  }, { attempts: 5 })

  await assert.rejects(() => wrapped(), /do not retry/)
  assert.equal(calls, 1)
})

test('retry applies a fixed delay between attempts', async () => {
  const timestamps = []
  let calls = 0
  const wrapped = retry(async () => {
    timestamps.push(Date.now())
    calls++
    if (calls < 3) throw new Error('fail')
    return 'ok'
  }, { attempts: 3, backoff: 'fixed', delay: 20 })

  await wrapped()
  assert.ok(timestamps[1] - timestamps[0] >= 15)
  assert.ok(timestamps[2] - timestamps[1] >= 15)
})

test('retry applies exponential backoff between attempts', async () => {
  const timestamps = []
  let calls = 0
  const wrapped = retry(async () => {
    timestamps.push(Date.now())
    calls++
    if (calls < 4) throw new Error('fail')
    return 'ok'
  }, { attempts: 4, backoff: 'exponential', delay: 10 })

  await wrapped()
  const gap1 = timestamps[1] - timestamps[0]
  const gap2 = timestamps[2] - timestamps[1]
  // exponential: ~10ms, ~20ms — the second gap should clearly be larger.
  assert.ok(gap2 > gap1)
})

test('retry forwards arguments to the wrapped function, per call', async () => {
  const wrapped = retry(async (a, b) => a + b, { attempts: 1 })
  assert.equal(await wrapped(2, 3), 5)
})

test('retry annotates the final error with structured pipeline metadata', async () => {
  const wrapped = retry(
    async () => { throw new Error('fail') },
    { attempts: 2, delay: 0 },
    { pipelineId: 'p1', id: 'node-4' }
  )

  try {
    await wrapped()
    assert.fail('should have thrown')
  } catch (error) {
    assert.equal(error.jojo.pipelineId, 'p1')
    assert.equal(error.jojo.nodeId, 'node-4')
    assert.equal(error.jojo.operation, 'retry')
    assert.equal(error.jojo.retryCount, 2)
    assert.ok(error.jojo.timestamp)
  }
})
