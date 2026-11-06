import test from 'node:test'
import assert from 'node:assert/strict'

import { A2AError, createA2AClient } from '../src/runtime/a2a.js'

function response(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    async json() {
      if (options.invalidJson) throw new SyntaxError('Unexpected token')
      return body
    }
  }
}

const agentCard = {
  supportedInterfaces: [{ protocolBinding: 'JSONRPC', url: 'https://agent.example/a2a' }]
}

function clientReturning(...responses) {
  return createA2AClient('https://agent.example', {
    fetch: async (url, options) => {
      const next = responses.shift()
      return typeof next === 'function' ? next(url, options) : next
    }
  })
}

async function discoveredClient(rpcResponse) {
  const client = clientReturning(response(agentCard), rpcResponse)
  await client.discover()
  return client
}

function rejectsWithCode(promise, code) {
  return assert.rejects(promise, error => {
    assert.ok(error instanceof A2AError)
    assert.equal(error.code, code)
    return true
  })
}

test('the client constructor validates its URL, headers, token, and fetch implementation', () => {
  assert.throws(() => createA2AClient(''), /An A2A agent URL is required/)
  assert.throws(() => createA2AClient('https://agent.example', { headers: [] }), /A2A headers must be an object/)
  assert.throws(() => createA2AClient('https://agent.example', { bearerToken: '' }), /bearerToken must be a non-empty string/)
  assert.throws(() => createA2AClient('https://agent.example', { fetch: 'nope' }), /A fetch implementation is required/)
})

test('discover rejects non-object, unparsable, and unsafe Agent Cards', async () => {
  await rejectsWithCode(clientReturning(response([])).discover(), 'INVALID_AGENT_CARD')
  await rejectsWithCode(clientReturning(response(null, { invalidJson: true })).discover(), 'INVALID_AGENT_CARD')
  await rejectsWithCode(
    clientReturning(response({ preferredTransport: 'JSONRPC', url: 'http://[invalid' })).discover(),
    'INVALID_AGENT_CARD'
  )
  await rejectsWithCode(
    clientReturning(response({ preferredTransport: 'JSONRPC', url: 'ftp://agent.example/rpc' })).discover(),
    'INVALID_AGENT_CARD'
  )
})

test('discover falls back to the preferred JSON-RPC transport URL', async () => {
  const client = clientReturning(response({ preferredTransport: 'JSONRPC', url: '/rpc' }))
  await client.discover()
  assert.equal(client.endpoint.href, 'https://agent.example/rpc')
})

test('discover wraps network failures and passes A2A errors through unchanged', async () => {
  const failing = clientReturning(() => { throw new Error('socket hang up') })
  await rejectsWithCode(failing.discover(), 'NETWORK_ERROR')

  const original = new A2AError('custom', { code: 'CUSTOM' })
  const passing = clientReturning(() => { throw original })
  await assert.rejects(passing.discover(), error => error === original)
})

test('an aborted request reports ABORTED even when fetch fails for another reason', async () => {
  const controller = new AbortController()
  const client = clientReturning(() => {
    controller.abort()
    throw new Error('connection reset')
  })
  await rejectsWithCode(client.discover({ signal: controller.signal }), 'ABORTED')
})

test('requests validate their inputs before reaching the network', async () => {
  const client = await discoveredClient(response({}))
  await assert.rejects(client.sendMessage('hello'), /A2A message must be an object/)
  await assert.rejects(client.getTask({}), /An A2A task id is required/)
  await assert.rejects(client.cancelTask(''), /An A2A task id is required/)
})

test('waitForTask validates its polling options', async () => {
  const client = await discoveredClient(response({}))
  await assert.rejects(client.waitForTask('t', { pollIntervalMs: -1 }), /pollIntervalMs must be a non-negative number/)
  await assert.rejects(client.waitForTask('t', { pollIntervalMs: 10, maxPollIntervalMs: 5 }), /maxPollIntervalMs must be at least pollIntervalMs/)
  await assert.rejects(client.waitForTask('t', { backoffMultiplier: 0.5 }), /backoffMultiplier must be at least 1/)
  await assert.rejects(client.waitForTask('t', { timeoutMs: 0 }), /timeoutMs must be a positive number/)
})

test('waitForTask rejects a task without a valid status', async () => {
  const client = await discoveredClient(response({}))
  await rejectsWithCode(client.waitForTask({ id: 't', status: 'working' }), 'INVALID_TASK')
})

test('JSON-RPC requests surface HTTP, malformed, and remote errors', async () => {
  await rejectsWithCode((await discoveredClient(response({}, { ok: false, status: 503 }))).getTask('t'), 'HTTP_ERROR')
  await rejectsWithCode((await discoveredClient(response(null, { invalidJson: true }))).getTask('t'), 'INVALID_RPC_RESPONSE')
  await rejectsWithCode((await discoveredClient(response({ jsonrpc: '2.0', id: 1, error: 'bad' }))).getTask('t'), 'INVALID_RPC_RESPONSE')

  const remote = await discoveredClient(response({ jsonrpc: '2.0', id: 1, error: { code: -32001, data: { id: 't' } } }))
  await assert.rejects(remote.getTask('t'), error => {
    assert.equal(error.code, 'REMOTE_ERROR')
    assert.equal(error.message, 'A2A JSON-RPC request failed')
    assert.equal(error.remoteCode, -32001)
    assert.deepEqual(error.data, { id: 't' })
    return true
  })
})
