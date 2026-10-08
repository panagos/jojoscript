import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createMcpServer,
  runMcpStdioServer
} from '../src/runtime/mcp.js'

test('createMcpServer registers tools and handles a tools/call request', async () => {
  const server = createMcpServer({
    tools: {
      echo: args => ({ content: [{ type: 'text', text: args.value }] })
    }
  })

  const response = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'echo', arguments: { value: 'hello' } }
  })

  assert.deepEqual(response, {
    jsonrpc: '2.0',
    id: 1,
    result: {
      content: [{ type: 'text', text: 'hello' }]
    }
  })
})

test('runMcpStdioServer responds to a JSON-RPC request over stdio', async () => {
  const server = createMcpServer({
    tools: {
      echo: args => ({ content: [{ type: 'text', text: args.value }] })
    }
  })

  const chunks = []
  const input = [JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'echo', arguments: { value: 'stdio' } }
  }) + '\n']

  const output = await runMcpStdioServer(server, {
    input,
    output: {
      write: chunk => chunks.push(chunk)
    }
  })

  assert.equal(output, 0)
  assert.deepEqual(JSON.parse(chunks.join('')), {
    jsonrpc: '2.0',
    id: 2,
    result: {
      content: [{ type: 'text', text: 'stdio' }]
    }
  })
})
