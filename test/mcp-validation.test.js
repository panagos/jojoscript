import test from 'node:test'
import assert from 'node:assert/strict'

import { createMcpServer, runMcpStdioServer } from '../src/runtime/mcp.js'

const protocolVersion = '2025-06-18'

async function initializedServer(tools) {
  const server = createMcpServer({ tools })
  await server.handleRequest({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion } })
  return server
}

function call(server, name, args) {
  return server.handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
}

const ok = () => ({ content: [{ type: 'text', text: 'ok' }] })

const schemaTool = {
  inputSchema: {
    type: 'object',
    properties: {
      mode: { enum: ['fast', 'slow'] },
      tags: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string', minLength: 2, maxLength: 4 } },
      ratio: { type: 'number' },
      count: { type: 'integer' },
      enabled: { type: 'boolean' },
      nothing: { type: 'null' },
      nested: { type: 'object', properties: { id: { type: 'string' } } }
    }
  },
  handler: ok
}

test('tool arguments are validated against enum, array, string, number, integer, boolean, null, and nested schemas', async () => {
  const server = await initializedServer({ schemaTool })
  const cases = [
    [{ mode: 'medium' }, 'arguments.mode must be one of the allowed values'],
    [{ tags: 'a' }, 'arguments.tags must be an array'],
    [{ tags: [] }, 'arguments.tags must contain at least 1 items'],
    [{ tags: ['ab', 'cd', 'ef'] }, 'arguments.tags must contain at most 2 items'],
    [{ tags: [1] }, 'arguments.tags[0] must be a string'],
    [{ tags: ['a'] }, 'arguments.tags[0] must be at least 2 characters'],
    [{ tags: ['abcde'] }, 'arguments.tags[0] must be at most 4 characters'],
    [{ ratio: Infinity }, 'arguments.ratio must be a number'],
    [{ count: 1.5 }, 'arguments.count must be an integer'],
    [{ enabled: 'yes' }, 'arguments.enabled must be a boolean'],
    [{ nothing: 0 }, 'arguments.nothing must be null'],
    [{ nested: 'x' }, 'arguments.nested must be an object'],
    [{ nested: { id: 1 } }, 'arguments.nested.id must be a string']
  ]

  for (const [args, message] of cases) {
    const response = await call(server, 'schemaTool', args)
    assert.equal(response.error.message, `Invalid tool arguments: ${message}`)
  }

  const valid = await call(server, 'schemaTool', {
    mode: 'fast', tags: ['ab'], ratio: 0.5, count: 2, enabled: true, nothing: null, nested: { id: 'x' }, extra: 1
  })
  assert.deepEqual(valid.result, ok())
})

test('plain function tools accept no arguments, and malformed tool definitions are rejected', async () => {
  const server = await initializedServer({ ping: ok })
  assert.deepEqual((await call(server, 'ping', undefined)).result, ok())
  assert.match((await call(server, 'ping', { extra: 1 })).error.message, /arguments.extra is not allowed/)

  assert.throws(() => createMcpServer({ tools: { broken: { handler: ok } } }), /Tool "broken" must define an inputSchema and handler/)
})

test('tool results are validated before they are returned', async () => {
  const outputSchema = { type: 'object', properties: { total: { type: 'number' } } }
  const server = await initializedServer({
    noContent: { inputSchema: { type: 'object' }, handler: () => ({}) },
    untyped: { inputSchema: { type: 'object' }, handler: () => ({ content: [{ text: 'x' }] }) },
    badFlag: { inputSchema: { type: 'object' }, handler: () => ({ content: [], isError: 'no' }) },
    badStructure: {
      inputSchema: { type: 'object' },
      outputSchema,
      handler: () => ({ content: [], structuredContent: { total: 'many' } })
    },
    throwsValue: { inputSchema: { type: 'object' }, handler: () => { throw 'plain failure' } }
  })

  const message = async name => (await call(server, name, {})).result.content[0].text
  assert.equal(await message('noContent'), 'Tool results must contain a content array')
  assert.equal(await message('untyped'), 'Tool result content items must have a type')
  assert.equal(await message('badFlag'), 'Tool result isError must be a boolean')
  assert.equal(await message('badStructure'), 'structuredContent.total must be a number')
  assert.equal(await message('throwsValue'), 'plain failure')
})

test('the server rejects invalid requests, ids, and lifecycle misuse', async () => {
  const server = createMcpServer()
  const request = message => server.handleRequest({ jsonrpc: '2.0', ...message })

  assert.equal((await server.handleRequest([])).error.code, -32600)
  assert.equal((await request({ id: {}, method: 'ping' })).error.code, -32600)
  assert.equal(await request({ method: 'initialize', params: { protocolVersion } }), undefined)
  assert.equal((await request({ id: 1, method: 'ping' })).error.message, 'Server is not initialized')
  assert.equal((await request({ id: 1, method: 'initialize', params: {} })).error.message, 'protocolVersion is required')
  assert.equal(
    (await request({ id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).error.message,
    'Unsupported protocol version: 1999-01-01'
  )

  await request({ id: 1, method: 'initialize', params: { protocolVersion } })
  assert.equal((await request({ id: 2, method: 'initialize', params: { protocolVersion } })).error.message, 'Server is already initialized')
  assert.equal((await request({ id: 3, method: 'resources/list' })).error.code, -32601)
  assert.equal((await request({ id: 4, method: 'tools/call', params: {} })).error.message, 'Tool name is required')
  assert.equal((await request({ id: 5, method: 'tools/call', params: { name: 'missing' } })).error.message, 'Unknown tool: missing')
})

test('the stdio transport skips blank lines and answers unparsable lines with a parse error', async () => {
  const server = createMcpServer()
  const written = []
  const output = { write: line => written.push(JSON.parse(line)) }

  await runMcpStdioServer(server, { input: ['', '{not json', JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })], output })

  assert.deepEqual(written, [{ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }])
})
