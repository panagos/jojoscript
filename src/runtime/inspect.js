import { getCurrentContext, getDefaultContext } from './execution-context.js'

/*
 * `inspect(items, label)` is a pure passthrough: it must never change what
 * flows through the pipeline. It records how many items passed, how long
 * that took, and derived throughput, then prints a small report (unless
 * the execution context is marked quiet, e.g. under `node --test`).
 */
export async function* inspect(items, label, meta = {}) {
  const ctx = getCurrentContext() ?? getDefaultContext()
  const start = process.hrtime.bigint()
  const startedAt = new Date().toISOString()
  let count = 0
  let failed = false

  try {
    for await (const item of items) {
      count++
      yield item
    }
  } catch (error) {
    failed = true
    throw error
  } finally {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6
    const durationSeconds = durationMs / 1000
    const throughput = durationSeconds > 0 ? count / durationSeconds : count

    const report = {
      label,
      id: meta.id ?? null,
      pipelineId: meta.pipelineId ?? null,
      items: count,
      succeeded: failed ? Math.max(count - 1, 0) : count,
      failed: failed ? 1 : 0,
      durationMs,
      throughput,
      startedAt,
      endedAt: new Date().toISOString(),
      memoryUsageBytes: typeof process.memoryUsage === 'function' ? process.memoryUsage().heapUsed : undefined
    }

    ctx?.metrics?.recordInspect(label, report)

    if (!ctx || !ctx.quiet) {
      console.log(formatInspectReport(report))
    }
  }
}

export function formatInspectReport(report) {
  const duration = (report.durationMs / 1000).toFixed(2)
  const throughput = Math.round(report.throughput)

  return [
    report.label,
    '-'.repeat(Math.max(report.label.length, 20)),
    `items:       ${report.items}`,
    `throughput:  ${throughput}/s`,
    `duration:    ${duration}s`
  ].join('\n')
}
