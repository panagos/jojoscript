import test from 'node:test'
import assert from 'node:assert/strict'

import { A2AError, createA2AClient } from '../src/runtime/a2a.js'

function response(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    async json() {
      return body
    }
  }
}

const agentCard = {
  name: 'Enrichment Agent',
  protocolVersion: '1.0.0',
  supportedInterfaces: [
    { protocolBinding: 'JSONRPC', url: 'https://agent.example/a2a' }
  ]
}

test('discover fetches the Agent Card and selects its JSON-RPC endpoint', async () => {
  const requests = []
  const client = createA2AClient('https://agent.example/', {
    fetch: async (url, options) => {
      requests.push({ url, options })
      return response(agentCard)
    }
  })

  assert.deepEqual(await client.discover(), agentCard)
  assert.equal(requests[0].url, 'https://agent.example/.well-known/agent-card.json')
  assert.equal(requests[0].options.method, 'GET')
})

test('sendMessage uses A2A JSON-RPC and returns the remote result', async () => {
  const requests = []
  const client = createA2AClient('https://agent.example', {
    fetch: async (url, options) => {
      requests.push({ url, options })
      if (options.method === 'GET') return response(agentCard)
      return response({
        jsonrpc: '2.0',
        id: 1,
        result: { id: 'task-1', status: { state: 'TASK_STATE_WORKING' } }
      })
    }
  })
  await client.discover()

  const message = {
    role: 'ROLE_USER',
    parts: [{ kind: 'data', data: { recordId: 'item-1' } }],
    metadata: { traceId: 'trace-1' }
  }
  const result = await client.sendMessage(message, { returnImmediately: true })

  assert.deepEqual(result, {
    id: 'task-1',
    status: { state: 'TASK_STATE_WORKING' }
  })
  assert.equal(requests[1].url, 'https://agent.example/a2a')
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    jsonrpc: '2.0',
    id: 1,
    method: 'SendMessage',
    params: {
      message,
      configuration: { returnImmediately: true }
    }
  })
})

test('waitForTask returns every terminal task unchanged, including interrupted states', async () => {
  const terminalStates = [
    'TASK_STATE_COMPLETED',
    'TASK_STATE_FAILED',
    'TASK_STATE_CANCELED',
    'TASK_STATE_REJECTED',
    'TASK_STATE_INPUT_REQUIRED',
    'TASK_STATE_AUTH_REQUIRED'
  ]

  for (const state of terminalStates) {
    const client = createA2AClient('https://agent.example', {
      fetch: async (url, options) => {
        if (options.method === 'GET') return response(agentCard)
        const request = JSON.parse(options.body)
        return response({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            id: 'task-3',
            contextId: 'context-3',
            status: { state },
            artifacts: [{ parts: [{ kind: 'data', data: { state } }] }],
            metadata: { source: 'agent' }
          }
        })
      }
    })
    await client.discover()

    const task = await client.waitForTask('task-3', { pollIntervalMs: 0 })
    assert.equal(task.status.state, state)
    assert.equal(task.contextId, 'context-3')
    assert.deepEqual(task.artifacts[0].parts[0], { kind: 'data', data: { state } })
    assert.deepEqual(task.metadata, { source: 'agent' })
  }
})

test('getTask and waitForTask poll until the remote task is terminal', async () => {
  const requests = []
  let pollCount = 0
  const client = createA2AClient('https://agent.example', {
    fetch: async (url, options) => {
      requests.push({ url, options })
      if (options.method === 'GET') return response(agentCard)
      const request = JSON.parse(options.body)
      if (request.method === 'SendMessage') {
        return response({ jsonrpc: '2.0', id: request.id, result: { id: 'task-2' } })
      }
      pollCount += 1
      return response({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          id: 'task-2',
          status: {
            state: pollCount === 1 ? 'TASK_STATE_WORKING' : 'TASK_STATE_COMPLETED'
          }
        }
      })
    }
  })
  await client.discover()
  await client.sendMessage({ role: 'ROLE_USER', parts: [{ text: 'Enrich' }] })

  const task = await client.waitForTask('task-2', { pollIntervalMs: 0 })

  assert.equal(task.status.state, 'TASK_STATE_COMPLETED')
  assert.deepEqual(JSON.parse(requests[2].options.body), {
    jsonrpc: '2.0',
    id: 2,
    method: 'GetTask',
    params: { id: 'task-2' }
  })
})

test('getTask preserves structured request options', async () => {
  let request
  const client = createA2AClient('https://agent.example', {
    fetch: async (url, options) => {
      if (options.method === 'GET') return response(agentCard)
      request = JSON.parse(options.body)
      return response({
        jsonrpc: '2.0',
        id: request.id,
        result: { id: 'task-structured', status: { state: 'TASK_STATE_COMPLETED' } }
      })
    }
  })
  await client.discover()

  await client.getTask({ id: 'task-structured', historyLength: 5 })

  assert.deepEqual(request.params, { id: 'task-structured', historyLength: 5 })
})

test('A2A client rejects JSON-RPC errors and HTTP errors', async () => {
  const rpcClient = createA2AClient('https://agent.example', {
    fetch: async (url, options) => options.method === 'GET'
      ? response(agentCard)
      : response({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32001, message: 'Agent is unavailable' }
        })
  })
  await rpcClient.discover()
  await assert.rejects(
    rpcClient.sendMessage({ role: 'ROLE_USER', parts: [{ text: 'Hello' }] }),
    /Agent is unavailable/
  )

  const httpClient = createA2AClient('https://agent.example', {
    fetch: async () => response({}, { ok: false, status: 503 })
  })
  await assert.rejects(httpClient.discover(), /503/)
})

test('A2A requests require a discovered JSON-RPC interface', async () => {
  const client = createA2AClient('https://agent.example', {
    fetch: async () => response({ name: 'No JSON-RPC interface' })
  })

  await assert.rejects(client.sendMessage({ role: 'ROLE_USER', parts: [] }), /discover/)
  await assert.rejects(client.discover(), /JSON-RPC/)
})

test('A2A client uses bearer authentication and cancels tasks explicitly', async () => {
  const requests = []
  const client = createA2AClient('https://agent.example', {
    bearerToken: 'secret-token',
    fetch: async (url, options) => {
      requests.push({ url, options })
      if (options.method === 'GET') return response(agentCard)
      const request = JSON.parse(options.body)
      return response({
        jsonrpc: '2.0',
        id: request.id,
        result: { id: request.params.id, status: { state: 'TASK_STATE_CANCELED' } }
      })
    }
  })
  await client.discover()

  const task = await client.cancelTask('task-4')

  assert.equal(requests[0].options.headers.authorization, 'Bearer secret-token')
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    jsonrpc: '2.0',
    id: 1,
    method: 'CancelTask',
    params: { id: 'task-4' }
  })
  assert.equal(task.status.state, 'TASK_STATE_CANCELED')
})

test('waitForTask stops polling when aborted or timed out', async () => {
  const controller = new AbortController()
  let requests = 0
  const client = createA2AClient('https://agent.example', {
    fetch: async (url, options) => {
      if (options.method === 'GET') return response(agentCard)
      requests += 1
      return response({
        jsonrpc: '2.0',
        id: JSON.parse(options.body).id,
        result: { id: 'task-5', status: { state: 'TASK_STATE_WORKING' } }
      })
    }
  })
  await client.discover()

  setTimeout(() => controller.abort(), 0)
  await assert.rejects(
    client.waitForTask('task-5', {
      pollIntervalMs: 100,
      signal: controller.signal
    }),
    error => error instanceof A2AError && error.code === 'ABORTED'
  )
  assert.equal(requests, 1)

  await assert.rejects(
    client.waitForTask('task-5', {
      pollIntervalMs: 100,
      timeoutMs: 1
    }),
    error => error instanceof A2AError && error.code === 'TIMEOUT'
  )

  const slowClient = createA2AClient('https://agent.example', {
    fetch: async (url, options) => {
      if (options.method === 'GET') return response(agentCard)
      const request = JSON.parse(options.body)
      return {
        ok: true,
        status: 200,
        async json() {
          await new Promise(resolve => setTimeout(resolve, 20))
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: { id: 'task-6', status: { state: 'TASK_STATE_COMPLETED' } }
          }
        }
      }
    }
  })
  await slowClient.discover()

  await assert.rejects(
    slowClient.waitForTask('task-6', { timeoutMs: 1 }),
    error => error instanceof A2AError && error.code === 'TIMEOUT'
  )
})

test('A2A client rejects unsafe discovery endpoints and classifies remote errors', async () => {
  const unsafeClient = createA2AClient('https://agent.example', {
    fetch: async () => response({
      ...agentCard,
      supportedInterfaces: [{ protocolBinding: 'JSONRPC', url: 'file:///tmp/agent' }]
    })
  })
  await assert.rejects(
    unsafeClient.discover(),
    error => error instanceof A2AError && error.code === 'INVALID_AGENT_CARD'
  )

  const rpcClient = createA2AClient('https://agent.example', {
    fetch: async (url, options) => options.method === 'GET'
      ? response(agentCard)
      : response({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32001, message: 'Agent is unavailable', data: { retryable: true } }
        })
  })
  await rpcClient.discover()
  await assert.rejects(
    rpcClient.sendMessage({ role: 'ROLE_USER', parts: [] }),
    error => error instanceof A2AError &&
      error.code === 'REMOTE_ERROR' &&
      error.data.retryable
  )
})
