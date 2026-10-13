const TERMINAL_TASK_STATES = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
  'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_AUTH_REQUIRED'
])

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function taskIdFrom(task) {
  const id = typeof task === 'string' ? task : task?.id
  if (typeof id !== 'string' || !id) {
    throw new TypeError('An A2A task id is required')
  }
  return id
}

function abortError(reason) {
  if (reason instanceof A2AError) return reason
  return new A2AError('A2A operation was aborted', {
    code: 'ABORTED',
    cause: reason
  })
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal.reason)
}

function waitForDelay(delayMs, signal) {
  throwIfAborted(signal)

  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, delayMs)
    function done() {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    function onAbort() {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(abortError(signal.reason))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function createWaitSignal(signal, timeoutMs, taskId) {
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  const timer = setTimeout(() => {
    controller.abort(new A2AError(`Timed out waiting for A2A task "${taskId}"`, {
      code: 'TIMEOUT'
    }))
  }, timeoutMs)

  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}

export class A2AError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'A2AError'
    this.code = options.code
    this.data = options.data
    this.status = options.status
    this.remoteCode = options.remoteCode
  }
}

export class A2AClient {
  constructor(agentUrl, options = {}) {
    if (typeof agentUrl !== 'string' || !agentUrl) {
      throw new TypeError('An A2A agent URL is required')
    }
    if (options.headers !== undefined && !isObject(options.headers)) {
      throw new TypeError('A2A headers must be an object')
    }
    if (options.bearerToken !== undefined &&
      (typeof options.bearerToken !== 'string' || !options.bearerToken)) {
      throw new TypeError('A2A bearerToken must be a non-empty string')
    }

    this.agentUrl = new URL(agentUrl)
    this.fetch = options.fetch ?? globalThis.fetch
    this.headers = {
      ...(options.bearerToken ? { authorization: `Bearer ${options.bearerToken}` } : {}),
      ...(options.headers ?? {})
    }
    this.agentCard = null
    this.endpoint = null
    this.requestId = 0

    if (typeof this.fetch !== 'function') {
      throw new TypeError('A fetch implementation is required')
    }
  }

  async discover(options = {}) {
    throwIfAborted(options.signal)

    const cardUrl = new URL('/.well-known/agent-card.json', this.agentUrl)
    const response = await this.#fetch(cardUrl.href, {
      method: 'GET',
      headers: this.headers,
      signal: options.signal
    }, 'Agent Card request')
    if (!response.ok) {
      throw new A2AError(`A2A Agent Card request failed with HTTP ${response.status}`, {
        code: 'DISCOVERY_HTTP_ERROR',
        status: response.status
      })
    }

    const card = await this.#readJson(response, 'A2A Agent Card', 'INVALID_AGENT_CARD')
    throwIfAborted(options.signal)
    if (!isObject(card)) {
      throw new A2AError('A2A Agent Card response must be a JSON object', {
        code: 'INVALID_AGENT_CARD'
      })
    }

    const jsonRpcInterface = card.supportedInterfaces?.find(
      item => isObject(item) && item.protocolBinding === 'JSONRPC' && typeof item.url === 'string'
    )
    const endpoint = jsonRpcInterface?.url
      ?? (card.preferredTransport === 'JSONRPC' ? card.url : null)

    if (typeof endpoint !== 'string' || !endpoint) {
      throw new A2AError('A2A Agent Card does not advertise a JSON-RPC interface', {
        code: 'UNSUPPORTED_INTERFACE'
      })
    }

    let endpointUrl
    try {
      endpointUrl = new URL(endpoint, cardUrl)
    } catch (error) {
      throw new A2AError('A2A Agent Card contains an invalid JSON-RPC endpoint', {
        code: 'INVALID_AGENT_CARD',
        cause: error
      })
    }
    if (!['http:', 'https:'].includes(endpointUrl.protocol) ||
      endpointUrl.username || endpointUrl.password) {
      throw new A2AError('A2A Agent Card contains an unsafe JSON-RPC endpoint', {
        code: 'INVALID_AGENT_CARD'
      })
    }

    this.agentCard = card
    this.endpoint = endpointUrl
    return card
  }

  async sendMessage(message, configuration, options = {}) {
    if (!isObject(message)) {
      throw new TypeError('A2A message must be an object')
    }

    const params = { message }
    if (configuration !== undefined) params.configuration = configuration
    return this.#request('SendMessage', params, options)
  }

  async getTask(task, options = {}) {
    const params = typeof task === 'string' ? { id: task } : task
    taskIdFrom(params)
    return this.#request('GetTask', params, options)
  }

  async cancelTask(task, options = {}) {
    const id = taskIdFrom(task)
    return this.#request('CancelTask', { id }, options)
  }

  async waitForTask(taskOrId, options = {}) {
    const taskId = taskIdFrom(taskOrId)
    const pollIntervalMs = options.pollIntervalMs ?? 1000
    const maxPollIntervalMs = options.maxPollIntervalMs ?? 30000
    const backoffMultiplier = options.backoffMultiplier ?? 1.5
    const timeoutMs = options.timeoutMs ?? 300000

    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
      throw new TypeError('pollIntervalMs must be a non-negative number')
    }
    if (!Number.isFinite(maxPollIntervalMs) || maxPollIntervalMs < pollIntervalMs) {
      throw new TypeError('maxPollIntervalMs must be at least pollIntervalMs')
    }
    if (!Number.isFinite(backoffMultiplier) || backoffMultiplier < 1) {
      throw new TypeError('backoffMultiplier must be at least 1')
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('timeoutMs must be a positive number')
    }

    const waiting = createWaitSignal(options.signal, timeoutMs, taskId)
    try {
      let task = typeof taskOrId === 'string'
        ? await this.getTask(taskId, { signal: waiting.signal })
        : taskOrId
      let intervalMs = pollIntervalMs

      while (!TERMINAL_TASK_STATES.has(task?.status?.state)) {
        if (!isObject(task) || !isObject(task.status) || typeof task.status.state !== 'string') {
          throw new A2AError(`A2A task "${taskId}" has an invalid status`, {
            code: 'INVALID_TASK'
          })
        }

        await waitForDelay(intervalMs, waiting.signal)
        task = await this.getTask(taskId, { signal: waiting.signal })
        intervalMs = Math.min(maxPollIntervalMs, intervalMs * backoffMultiplier)
      }

      return task
    } finally {
      waiting.cleanup()
    }
  }

  async #fetch(url, options, description) {
    try {
      const response = await this.fetch(url, options)
      throwIfAborted(options.signal)
      return response
    } catch (error) {
      if (options.signal?.aborted) throw abortError(options.signal.reason)
      if (error instanceof A2AError) throw error
      throw new A2AError(`A2A ${description} failed`, {
        code: 'NETWORK_ERROR',
        cause: error
      })
    }
  }

  async #readJson(response, description, code) {
    try {
      return await response.json()
    } catch (error) {
      throw new A2AError(`${description} response is not valid JSON`, {
        code,
        cause: error
      })
    }
  }

  async #request(method, params, options = {}) {
    if (!this.endpoint) {
      throw new A2AError('Call discover() before making A2A requests', {
        code: 'NOT_DISCOVERED'
      })
    }
    throwIfAborted(options.signal)

    const requestId = ++this.requestId
    const response = await this.#fetch(this.endpoint.href, {
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
      }),
      signal: options.signal
    }, `${method} request`)
    if (!response.ok) {
      throw new A2AError(`A2A ${method} request failed with HTTP ${response.status}`, {
        code: 'HTTP_ERROR',
        status: response.status
      })
    }

    const payload = await this.#readJson(response, `A2A ${method}`, 'INVALID_RPC_RESPONSE')
    throwIfAborted(options.signal)
    if (
      !isObject(payload)
      || payload.jsonrpc !== '2.0'
      || payload.id !== requestId
      || (!Object.hasOwn(payload, 'result') && !Object.hasOwn(payload, 'error'))
    ) {
      throw new A2AError(`Invalid JSON-RPC response for A2A method "${method}"`, {
        code: 'INVALID_RPC_RESPONSE'
      })
    }
    if (payload.error) {
      if (!isObject(payload.error)) {
        throw new A2AError(`Invalid JSON-RPC error for A2A method "${method}"`, {
          code: 'INVALID_RPC_RESPONSE'
        })
      }
      throw new A2AError(payload.error.message ?? 'A2A JSON-RPC request failed', {
        code: 'REMOTE_ERROR',
        remoteCode: payload.error.code,
        data: payload.error.data
      })
    }

    return payload.result
  }
}

export function createA2AClient(agentUrl, options = {}) {
  return new A2AClient(agentUrl, options)
}
