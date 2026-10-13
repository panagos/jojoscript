import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { MemoryCheckpointStore } from 'jojoscript/runtime'
import { createEnrichmentServer } from '../dist/application/mcp-a2a-resumable-enrichment.js'

const protocolVersion = '2025-06-18'

function request(id, method, params) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params
  }
}

test('the MCP enrichment tool checkpoints completed batches and retries uncommitted A2A work', async () => {
  let sendMessageCalls = 0
  const delegatedRecordIds = []
  const agent = createServer(async (incoming, outgoing) => {
    if (incoming.method === 'GET' && incoming.url === '/.well-known/agent-card.json') {
      outgoing.writeHead(200, { 'content-type': 'application/json' })
      outgoing.end(JSON.stringify({
        name: 'Enrichment Agent',
        protocolVersion: '1.0.0',
        supportedInterfaces: [{
          protocolBinding: 'JSONRPC',
          url: `http://127.0.0.1:${agent.address().port}/a2a`
        }]
      }))
      return
    }

    let body = ''
    for await (const chunk of incoming) body += chunk
    const rpcRequest = JSON.parse(body)

    if (rpcRequest.method === 'SendMessage') {
      sendMessageCalls += 1
      const text = rpcRequest.params.message.parts[0].text
      delegatedRecordIds.push(text.match(/ID: (.+)/)?.[1])
      if (sendMessageCalls === 2) {
        outgoing.writeHead(503, { 'content-type': 'application/json' })
        outgoing.end(JSON.stringify({ error: 'Agent unavailable' }))
        return
      }
    }

    const result = rpcRequest.method === 'SendMessage'
      ? {
          id: `task-${sendMessageCalls}`,
          status: { state: 'TASK_STATE_COMPLETED' },
          artifacts: [{ parts: [{ text: JSON.stringify({ category: 'enriched' }) }] }]
        }
      : { id: rpcRequest.params.id, status: { state: 'TASK_STATE_COMPLETED' } }

    outgoing.writeHead(200, { 'content-type': 'application/json' })
    outgoing.end(JSON.stringify({
      jsonrpc: '2.0',
      id: rpcRequest.id,
      result
    }))
  })

  await new Promise(resolve => agent.listen(0, '127.0.0.1', resolve))
  try {
    const server = createEnrichmentServer({
      agentUrl: `http://127.0.0.1:${agent.address().port}`,
      checkpointStore: new MemoryCheckpointStore()
    })

    await server.handleRequest(request(1, 'initialize', {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'example-client', version: '1.0.0' }
    }))

    const params = {
      jobId: 'batch-1',
      records: [
        { id: 'record-1', title: 'First record' },
        { id: 'record-2', title: 'Second record' }
      ]
    }
    const failed = await server.handleRequest(request(2, 'tools/call', {
      name: 'enrich_records',
      arguments: params
    }))
    assert.equal(failed.result.isError, true)
    assert.match(failed.result.content[0].text, /503/)

    const recovered = await server.handleRequest(request(3, 'tools/call', {
      name: 'enrich_records',
      arguments: params
    }))
    assert.deepEqual(recovered.result.structuredContent, {
      records: [
        { id: 'record-1', title: 'First record', category: 'enriched' },
        { id: 'record-2', title: 'Second record', category: 'enriched' }
      ]
    })
    assert.deepEqual(delegatedRecordIds, [
      'record-1',
      'record-2',
      'record-1',
      'record-2'
    ])
    assert.equal(sendMessageCalls, 4)

    const resumed = await server.handleRequest(request(4, 'tools/call', {
      name: 'enrich_records',
      arguments: params
    }))
    assert.deepEqual(resumed.result.structuredContent, recovered.result.structuredContent)
    assert.equal(sendMessageCalls, 4)
  } finally {
    await new Promise((resolve, reject) => {
      agent.close(error => error ? reject(error) : resolve())
    })
  }
})
