const TERMINAL_TASK_STATES = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
  'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_AUTH_REQUIRED'
])

export class A2AError extends Error {
  constructor(message, options = {}) {
    super(message, options)
    this.name = 'A2AError'
    this.code = options.code
    this.data = options.data
  }
}

export class A2AClient {
  constructor(agentUrl, options = {}) {
    if (typeof agentUrl !== 'string' || !agentUrl) {
      throw new TypeError('An A2A agent URL is required')
    }

    this.agentUrl = new URL(agentUrl)
    this.fetch = options.fetch ?? globalThis.fetch
    this.headers = options.headers ?? {}
    this.agentCard = null
    this.endpoint = null
    this.requestId = 0

    if (typeof this.fetch !== 'function') {
      throw new TypeError('A fetch implementation is required')
    }
  }

  async discover() {
    const cardUrl = new URL('/.well-known/agent-card.json', this.agentUrl)
    const response = await this.fetch(cardUrl.href, { method: 'GET', headers: this.headers })
    if (!response.ok) {
      throw new A2AError(`A2A Agent Card request failed with HTTP ${response.status}`)
    }

    const card = await response.json()
    if (!card || typeof card !== 'object' || Array.isArray(card)) {
      throw new A2AError('A2A Agent Card response must be a JSON object')
    }

    const jsonRpcInterface = card.supportedInterfaces?.find(
      item => item.protocolBinding === 'JSONRPC' && typeof item.url === 'string'
    )
    const endpoint = jsonRpcInterface?.url
      ?? (card.preferredTransport === 'JSONRPC' ? card.url : null)

    if (typeof endpoint !== 'string' || !endpoint) {
      throw new A2AError('A2A Agent Card does not advertise a JSON-RPC interface')
    }

    this.agentCard = card
    this.endpoint = new URL(endpoint, cardUrl)
    return card
  }

  async sendMessage(message, configuration) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new TypeError('A2A message must be an object')
    }

    const params = { message }
    if (configuration !== undefined) params.configuration = configuration
    return this.#request('SendMessage', params)
  }

  async getTask(task) {
    const params = typeof task === 'string' ? { id: task } : task
    if (!params || typeof params !== 'object' || Array.isArray(params) || !params.id) {
      throw new TypeError('A2A GetTask requires a task id')
    }
    return this.#request('GetTask', params)
  }

  async waitForTask(taskId, options = {}) {
    const pollIntervalMs = options.pollIntervalMs ?? 1000
    const timeoutMs = options.timeoutMs ?? 300000

    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
      throw new TypeError('pollIntervalMs must be a non-negative number')
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('timeoutMs must be a positive number')
    }

    const deadline = Date.now() + timeoutMs
    let task = await this.getTask(taskId)

    while (!TERMINAL_TASK_STATES.has(task.status?.state)) {
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) {
        throw new A2AError(`Timed out waiting for A2A task "${taskId}"`)
      }

      await new Promise(resolve => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)))
      task = await this.getTask(taskId)
    }

    return task
  }

  async #request(method, params) {
    if (!this.endpoint) {
      throw new A2AError('Call discover() before making A2A requests')
    }

    const requestId = ++this.requestId
    const response = await this.fetch(this.endpoint.href, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...this.headers
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        method,
        params
      })
    })
    if (!response.ok) {
      throw new A2AError(`A2A ${method} request failed with HTTP ${response.status}`)
    }

    const payload = await response.json()
    if (
      !payload
      || payload.jsonrpc !== '2.0'
      || payload.id !== requestId
      || (!Object.hasOwn(payload, 'result') && !Object.hasOwn(payload, 'error'))
    ) {
      throw new A2AError(`Invalid JSON-RPC response for A2A method "${method}"`)
    }
    if (payload.error) {
      throw new A2AError(payload.error.message ?? 'A2A JSON-RPC request failed', {
        code: payload.error.code,
        data: payload.error.data
      })
    }

    return payload.result
  }
}

export function createA2AClient(agentUrl, options = {}) {
  return new A2AClient(agentUrl, options)
}
