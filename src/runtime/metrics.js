/*
 * Aggregates per-node execution metrics for a single pipeline execution:
 * item counts, cumulative duration, and derived throughput. Used by both
 * `inspect()` (a single named checkpoint the user asked to observe) and the
 * `jojo profile` compiler instrumentation (every node, automatically).
 */
export class Metrics {
  constructor() {
    this.nodes = new Map()
    this.inspections = []
  }

  record(id, type, items, durationMs) {
    if (!id) return

    const existing = this.nodes.get(id) ?? { id, type, items: 0, durationMs: 0 }
    existing.items += items
    existing.durationMs += durationMs
    existing.type = type
    this.nodes.set(id, existing)
  }

  recordInspect(label, report) {
    this.inspections.push(report)
  }

  toJSON() {
    return {
      nodes: [...this.nodes.values()].map(node => ({
        ...node,
        throughput: throughputOf(node.items, node.durationMs)
      })),
      inspections: this.inspections
    }
  }
}

export function throughputOf(items, durationMs) {
  const seconds = durationMs / 1000
  return seconds > 0 ? items / seconds : items
}
