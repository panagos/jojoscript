import test from 'node:test'
import assert from 'node:assert/strict'

import { createA2AClient } from '../src/runtime/a2a.js'

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

  const message = { role: 'ROLE_USER', parts: [{ text: 'Enrich this record' }] }
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
