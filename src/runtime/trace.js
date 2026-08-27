import { getCurrentContext, getDefaultContext } from './execution-context.js'

/*
 * Generic per-node instrumentation used only by `jojo profile` (the
 * compiler wraps every stage's output with a call to this function when
 * compiled with `{ profile: true }`). It must be transparent to *type*,
 * not just to values: eager results (arrays, Maps, Sets, scalars) are
 * counted and returned completely unchanged, while lazy
 * generator/async-generator results are wrapped in an equivalent
 * generator that counts items as they're pulled through — never
 * materializing anything itself.
 */
export function traceNode(value, meta = {}) {
  const ctx = getCurrentContext() ?? getDefaultContext()
  const start = process.hrtime.bigint()

  function finish(count) {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6
    ctx.metrics.record(meta.id, meta.type, count, durationMs)
  }

  const isAsyncGenerator = value != null &&
    typeof value.next === 'function' &&
    typeof value[Symbol.asyncIterator] === 'function'

  const isSyncGenerator = !isAsyncGenerator && value != null &&
    typeof value.next === 'function' &&
    typeof value[Symbol.iterator] === 'function'

  if (isAsyncGenerator) {
    return (async function* () {
      let count = 0
      try {
        for await (const item of value) {
          count++
          yield item
        }
      } finally {
        finish(count)
      }
    })()
  }

  if (isSyncGenerator) {
    return (function* () {
      let count = 0
      try {
        for (const item of value) {
          count++
          yield item
        }
      } finally {
        finish(count)
      }
    })()
  }

  const count = Array.isArray(value)
    ? value.length
    : value instanceof Map || value instanceof Set
      ? value.size
      : 1

  finish(count)
  return value
}
