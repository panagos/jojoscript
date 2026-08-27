/*
 * An error thrown by user code (or attached with `.retryable = false`) that
 * `retry()` must never retry, no matter how many attempts remain.
 */
export class NonRetryableError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'NonRetryableError'
    this.retryable = false
  }
}

/*
 * A structured pipeline failure. Carries enough context (which pipeline,
 * which node, which item, how many retries were attempted) for the CLI to
 * print a useful failure report instead of a raw stack trace.
 */
export class PipelineError extends Error {
  constructor(message, details = {}) {
    super(message, { cause: details.cause })
    this.name = 'PipelineError'
    this.pipelineId = details.pipelineId ?? null
    this.nodeId = details.nodeId ?? null
    this.operation = details.operation ?? null
    this.itemIndex = details.itemIndex ?? null
    this.retryCount = details.retryCount ?? 0
    this.timestamp = details.timestamp ?? new Date().toISOString()
  }
}
