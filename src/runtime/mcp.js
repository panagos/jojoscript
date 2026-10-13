/*
 * Minimal MCP-style JSON-RPC transport for Node.js. The server is protocol-
 * focused rather than introducing MCP-specific JojoScript syntax; tool
 * implementations remain ordinary JavaScript functions.
 */

import { createInterface } from 'node:readline'

export const MCP_PROTOCOL_VERSION = '2025-06-18'

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message }
  }
}

function validateSchema(value, schema, path = 'value') {
  if (!isObject(schema)) return null

  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) {
    return `${path} must be one of the allowed values`
  }

  if (schema.type === 'object') {
    if (!isObject(value)) return `${path} must be an object`

    for (const name of schema.required ?? []) {
      if (!Object.hasOwn(value, name)) return `${name} is required`
    }

    const properties = schema.properties ?? {}
    for (const [name, propertyValue] of Object.entries(value)) {
      if (!Object.hasOwn(properties, name)) {
        if (schema.additionalProperties === false) {
          return `${path}.${name} is not allowed`
        }
        continue
      }

      const error = validateSchema(propertyValue, properties[name], `${path}.${name}`)
      if (error) return error
    }
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) return `${path} must be an array`
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return `${path} must contain at least ${schema.minItems} items`
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return `${path} must contain at most ${schema.maxItems} items`
    }
    if (schema.items) {
      for (const [index, item] of value.entries()) {
        const error = validateSchema(item, schema.items, `${path}[${index}]`)
        if (error) return error
      }
    }
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') return `${path} must be a string`
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return `${path} must be at least ${schema.minLength} characters`
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return `${path} must be at most ${schema.maxLength} characters`
    }
  }

  if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    return `${path} must be a number`
  }

  if (schema.type === 'integer' && (!Number.isInteger(value))) {
    return `${path} must be an integer`
  }

  if (schema.type === 'boolean' && typeof value !== 'boolean') {
    return `${path} must be a boolean`
  }

  if (schema.type === 'null' && value !== null) return `${path} must be null`

  return null
}

function normalizeTool(name, tool) {
  if (typeof tool === 'function') {
    return {
      name,
      inputSchema: { type: 'object', additionalProperties: false },
      handler: tool
    }
  }

  if (!isObject(tool) || typeof tool.handler !== 'function' || !isObject(tool.inputSchema)) {
    throw new TypeError(`Tool "${name}" must define an inputSchema and handler`)
  }

  return {
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    handler: tool.handler
  }
}

function toolDefinition(tool) {
  const definition = {
    name: tool.name,
    inputSchema: tool.inputSchema
  }

  if (typeof tool.description === 'string') definition.description = tool.description
  if (isObject(tool.outputSchema)) definition.outputSchema = tool.outputSchema

  return definition
}

function toolError(error) {
  return {
    content: [{
      type: 'text',
      text: error instanceof Error ? error.message : String(error)
    }],
    isError: true
  }
}

function validateToolResult(result, tool) {
  if (!isObject(result) || !Array.isArray(result.content)) {
    return 'Tool results must contain a content array'
  }

  if (result.content.some(content => !isObject(content) || typeof content.type !== 'string')) {
    return 'Tool result content items must have a type'
  }

  if (result.isError !== undefined && typeof result.isError !== 'boolean') {
    return 'Tool result isError must be a boolean'
  }

  if (result.structuredContent !== undefined && tool.outputSchema) {
    return validateSchema(result.structuredContent, tool.outputSchema, 'structuredContent')
  }

  return null
}

export class McpServer {
  constructor({
    tools = {},
    name = 'JojoScript',
    version = '0.10.0',
    protocolVersion = MCP_PROTOCOL_VERSION
  } = {}) {
    this.tools = new Map(
      Object.entries(tools).map(([toolName, tool]) => [toolName, normalizeTool(toolName, tool)])
    )
    this.serverInfo = { name, version }
    this.protocolVersion = protocolVersion
    this.initialized = false
  }

  async handleRequest(message) {
    if (!isObject(message) || message.jsonrpc !== '2.0' ||
      typeof message.method !== 'string' || message.method.length === 0 ||
      (message.params !== undefined && !isObject(message.params))) {
      return jsonRpcError(null, -32600, 'Invalid Request')
    }

    const isNotification = !Object.hasOwn(message, 'id')
    const id = isNotification ? null : message.id

    if (!isNotification && id !== null && typeof id !== 'string' &&
      (typeof id !== 'number' || !Number.isFinite(id))) {
      return jsonRpcError(null, -32600, 'Invalid Request')
    }

    const respond = response => isNotification ? undefined : response

    if (message.method === 'initialize') {
      if (isNotification) return undefined
      if (this.initialized) return respond(jsonRpcError(id, -32600, 'Server is already initialized'))

      const requestedVersion = message.params?.protocolVersion
      if (typeof requestedVersion !== 'string') {
        return respond(jsonRpcError(id, -32602, 'protocolVersion is required'))
      }
      if (requestedVersion !== this.protocolVersion) {
        return respond(jsonRpcError(id, -32602, `Unsupported protocol version: ${requestedVersion}`))
      }

      this.initialized = true
      return respond({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: this.protocolVersion,
          capabilities: {
            tools: { listChanged: false }
          },
          serverInfo: this.serverInfo
        }
      })
    }

    if (isNotification) return undefined
    if (!this.initialized) return jsonRpcError(id, -32600, 'Server is not initialized')

    if (message.method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} }
    }

    if (message.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: [...this.tools.values()].map(toolDefinition) }
      }
    }

    if (message.method !== 'tools/call') {
      return jsonRpcError(id, -32601, 'Method not found')
    }

    const toolName = message.params?.name
    if (typeof toolName !== 'string') {
      return jsonRpcError(id, -32602, 'Tool name is required')
    }

    const tool = this.tools.get(toolName)
    if (!tool) return jsonRpcError(id, -32602, `Unknown tool: ${toolName}`)

    const toolArgs = message.params.arguments ?? {}
    const validationError = validateSchema(toolArgs, tool.inputSchema, 'arguments')
    if (validationError) {
      return jsonRpcError(id, -32602, `Invalid tool arguments: ${validationError}`)
    }

    try {
      const result = await tool.handler(toolArgs)
      const resultError = validateToolResult(result, tool)
      return {
        jsonrpc: '2.0',
        id,
        result: resultError ? toolError(new Error(resultError)) : result
      }
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        result: toolError(error)
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

    let message
    try {
      message = JSON.parse(line)
    } catch {
      output.write(`${JSON.stringify(jsonRpcError(null, -32700, 'Parse error'))}\n`)
      continue
    }

    const response = await server.handleRequest(message)
    if (response) output.write(`${JSON.stringify(response)}\n`)
  }

  return 0
}
