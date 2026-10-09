import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { enrichRecord } from '../dist/application/a2a-enrichment.js'

test('the JojoScript example discovers an A2A agent and merges its task result', async () => {
  const methods = []
  let receivedMessage
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/.well-known/agent-card.json') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        name: 'Enrichment Agent',
        protocolVersion: '1.0.0',
        supportedInterfaces: [
          { protocolBinding: 'JSONRPC', url: `http://127.0.0.1:${server.address().port}/a2a` }
        ]
      }))
      return
    }

    let body = ''
    for await (const chunk of request) body += chunk
    const rpcRequest = JSON.parse(body)
    methods.push(rpcRequest.method)
    if (rpcRequest.method === 'SendMessage') receivedMessage = rpcRequest.params.message

    const result = rpcRequest.method === 'SendMessage'
      ? { id: 'enrich-1', status: { state: 'TASK_STATE_WORKING' } }
      : {
          id: 'enrich-1',
          status: { state: 'TASK_STATE_COMPLETED' },
          artifacts: [{ parts: [{ text: JSON.stringify({ category: 'science' }) }] }]
        }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      jsonrpc: '2.0',
      id: rpcRequest.id,
      result
    }))
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const result = await enrichRecord(
      { id: 'article-1', title: 'New discovery' },
      `http://127.0.0.1:${server.address().port}`
    )

    assert.deepEqual(result, {
      id: 'article-1',
      title: 'New discovery',
      category: 'science'
    })
    assert.deepEqual(receivedMessage, {
      role: 'ROLE_USER',
      parts: [{
        text: 'Return JSON fields that enrich this record:\nID: article-1\nTitle: New discovery'
      }]
    })
    assert.deepEqual(methods, ['SendMessage', 'GetTask'])
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
})
