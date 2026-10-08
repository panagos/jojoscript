/*
 * Minimal MCP-style JSON-RPC transport for Node.js. The server is protocol-
 * focused rather than introducing MCP-specific JojoScript syntax; tool
 * implementations remain ordinary JavaScript functions.
 */

import { createInterface } from 'node:readline'

export class McpServer {
  constructor({ tools = {} } = {}) {
    this.tools = new Map(Object.entries(tools))
  }

  async handleRequest(message) {
    if (!message || typeof message !== 'object') {
      return {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message: 'Invalid Request'
        }
      }
    }

    if (message.method !== 'tools/call') {
      return {
        jsonrpc: '2.0',
        id: message.id ?? null,
        error: {
          code: -32601,
          message: 'Method not found'
        }
      }
    }

    const toolName = message.params?.name
    const toolArgs = message.params?.arguments ?? {}
    const tool = this.tools.get(toolName)

    if (!tool || typeof tool !== 'function') {
      return {
        jsonrpc: '2.0',
        id: message.id ?? null,
        error: {
          code: -32602,
          message: `Unknown tool: ${toolName}`
        }
      }
    }

    try {
      const result = await tool(toolArgs)
      return {
        jsonrpc: '2.0',
        id: message.id ?? null,
        result
      }
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: message.id ?? null,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }
}

export function createMcpServer(options = {}) {
  return new McpServer(options)
}

export async function runMcpStdioServer(server, options = {}) {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout

  const lines = Array.isArray(input)
    ? input.values()
    : createInterface({ input, crlfDelay: Infinity })

  for await (const line of lines) {
    if (!line.trim()) continue

    const message = JSON.parse(line)
    const response = await server.handleRequest(message)
    output.write(`${JSON.stringify(response)}\n`)
  }

  return 0
}
