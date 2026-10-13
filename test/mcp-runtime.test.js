import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createMcpServer,
  runMcpStdioServer
} from '../src/runtime/mcp.js'

const protocolVersion = '2025-06-18'

function createServer() {
  return createMcpServer({
    name: 'test-server',
    version: '1.0.0',
    tools: {
      echo: {
        description: 'Returns the supplied value.',
        inputSchema: {
          type: 'object',
          properties: {
            value: { type: 'string' }
          },
          required: ['value'],
          additionalProperties: false
        },
        handler: args => ({
          content: [{ type: 'text', text: args.value }]
        })
      }
    }
  })
}

async function initialize(server, id = 1) {
  return server.handleRequest({
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  })
}

test('McpServer negotiates initialization and lists registered tool schemas', async () => {
  const server = createServer()

  assert.deepEqual(await initialize(server), {
    jsonrpc: '2.0',
    id: 1,
    result: {
      protocolVersion,
      capabilities: {
        tools: { listChanged: false }
      },
      serverInfo: { name: 'test-server', version: '1.0.0' }
    }
  })

  assert.equal(await server.handleRequest({
    jsonrpc: '2.0',
    method: 'notifications/initialized'
  }), undefined)

  assert.deepEqual(await server.handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list'
  }), {
    jsonrpc: '2.0',
    id: 2,
    result: {
      tools: [{
        name: 'echo',
        description: 'Returns the supplied value.',
        inputSchema: {
          type: 'object',
          properties: {
            value: { type: 'string' }
          },
          required: ['value'],
          additionalProperties: false
        }
      }]
    }
  })
})

test('McpServer validates initialization, requests, and notifications', async () => {
  const server = createServer()

  assert.deepEqual(await server.handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: 'unsupported',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  }), {
    jsonrpc: '2.0',
    id: 1,
    error: {
      code: -32602,
      message: 'Unsupported protocol version: unsupported'
    }
  })

  assert.deepEqual(await server.handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list'
  }), {
    jsonrpc: '2.0',
    id: 2,
    error: {
      code: -32600,
      message: 'Server is not initialized'
    }
  })

  assert.equal(await server.handleRequest({
    jsonrpc: '2.0',
    method: 'unknown/notification'
  }), undefined)

  assert.equal(await server.handleRequest({
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  }), undefined)

  assert.deepEqual(await server.handleRequest({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/list'
  }), {
    jsonrpc: '2.0',
    id: 3,
    error: {
      code: -32600,
      message: 'Server is not initialized'
    }
  })

  assert.deepEqual(await server.handleRequest({
    jsonrpc: '1.0',
    id: 4,
    method: 'ping'
  }), {
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32600,
      message: 'Invalid Request'
    }
  })
})

test('McpServer handles ping and validates tool arguments before invoking tools', async () => {
  const server = createServer()
  await initialize(server)

  assert.deepEqual(await server.handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'ping'
  }), {
    jsonrpc: '2.0',
    id: 2,
    result: {}
  })

  assert.deepEqual(await server.handleRequest({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'echo', arguments: {} }
  }), {
    jsonrpc: '2.0',
    id: 3,
    error: {
      code: -32602,
      message: 'Invalid tool arguments: value is required'
    }
  })

  assert.deepEqual(await server.handleRequest({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'echo', arguments: { value: 'hello' } }
  }), {
    jsonrpc: '2.0',
    id: 4,
    result: {
      content: [{ type: 'text', text: 'hello' }]
    }
  })
})

test('McpServer returns tool failures as CallToolResult errors', async () => {
  const server = createMcpServer({
    tools: {
      fail: {
        inputSchema: { type: 'object', additionalProperties: false },
        handler: () => {
          throw new Error('Tool failed')
        }
      }
    }
  })
  await initialize(server)

  assert.deepEqual(await server.handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'fail', arguments: {} }
  }), {
    jsonrpc: '2.0',
    id: 2,
    result: {
      content: [{ type: 'text', text: 'Tool failed' }],
      isError: true
    }
  })
})

test('McpServer rejects malformed CallToolResult content', async () => {
  const server = createMcpServer({
    tools: {
      invalid: {
        inputSchema: { type: 'object', additionalProperties: false },
        handler: () => ({ content: [{}] })
      }
    }
  })
  await initialize(server)

  assert.deepEqual(await server.handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'invalid', arguments: {} }
  }), {
    jsonrpc: '2.0',
    id: 2,
    result: {
      content: [{
        type: 'text',
        text: 'Tool result content items must have a type'
      }],
      isError: true
    }
  })
})

test('runMcpStdioServer emits parse errors and omits notification responses', async () => {
  const server = createServer()
  const chunks = []
  const input = [
    '{not JSON}\n',
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    }) + '\n',
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }) + '\n',
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'echo', arguments: { value: 'stdio' } }
    }) + '\n'
  ]

  const exitCode = await runMcpStdioServer(server, {
    input,
    output: { write: chunk => chunks.push(chunk) }
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(chunks.map(chunk => JSON.parse(chunk)), [
    {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' }
    },
    {
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'test-server', version: '1.0.0' }
      }
    },
    {
      jsonrpc: '2.0',
      id: 2,
      result: {
        content: [{ type: 'text', text: 'stdio' }]
      }
    }
  ])
})
