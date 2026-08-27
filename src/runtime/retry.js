import { NonRetryableError } from './errors.js'

/*
 * Wraps `fn` so calling the returned function retries on failure, up to
 * `options.attempts` total tries, with an optional fixed or exponential
 * delay between attempts. Errors marked non-retryable (`NonRetryableError`,
 * or any error with `error.retryable === false`) are never retried and
 * propagate immediately.
 *
 * Used two ways by compiled pipelines:
 *  - fused into a preceding `map`/`mapAsync`/`filterAsync`/`tap` stage, so
 *    each *item* is retried independently: `map(items, retry(fetch, opts))`.
 *  - standalone, wrapping the whole pipeline expression built so far as a
 *    zero-argument thunk: `retry(() => (expr), opts)()`.
 */
export function retry(fn, options = {}, meta = {}) {
  const attempts = options.attempts ?? 1
  const backoff = options.backoff ?? 'fixed'
  const delayMs = options.delay ?? 0

  return async function retried(...args) {
    let attempt = 1

    while (true) {
      try {
        return await fn(...args)
      } catch (error) {
        if (error instanceof NonRetryableError || error?.retryable === false) {
          annotate(error, meta, attempt)
          throw error
        }
        if (attempt >= attempts) {
          annotate(error, meta, attempt)
          throw error
        }

        const wait = backoff === 'exponential'
          ? delayMs * 2 ** (attempt - 1)
          : delayMs

        if (wait > 0) await sleep(wait)
        attempt++
      }
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/*
 * Attaches structured failure context (§16: pipelineId, nodeId, retryCount)
 * to the error without changing its type/instanceof behavior, so the CLI
 * (or user code) can report exactly which pipeline node exhausted retries.
 */
function annotate(error, meta, retryCount) {
  if (error && typeof error === 'object') {
    error.jojo = {
      pipelineId: meta.pipelineId ?? null,
      nodeId: meta.id ?? null,
      operation: 'retry',
      retryCount,
      timestamp: new Date().toISOString()
    }
  }
}
