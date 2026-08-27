import { findAllPipelines } from './pipeline-parser.js'
import { computePipelineId } from './pipeline-hash.js'

/*
 * Static, execution-free representation of a pipeline: SOURCE, one node per
 * stage, RESULT, chained by `dependencies`. Used by `jojo graph` (pure
 * text/DOT rendering, no execution) and correlated at runtime with
 * `jojo profile`'s collected metrics via the same `node-<n>` id scheme the
 * compiler uses when emitting code (see `pipeline-parser.js`'s
 * `emitPipeline`).
 */
export function buildGraph(pipeline, pipelineId = computePipelineId(pipeline)) {
  const nodes = []

  nodes.push({
    id: 'node-0',
    type: 'source',
    label: pipeline.expression.trim(),
    args: [],
    dependencies: [],
    metadata: {}
  })

  pipeline.stages.forEach((stage, index) => {
    nodes.push({
      id: `node-${index + 1}`,
      type: stage.name,
      label: stage.args.length ? `${stage.name}(${stage.args.join(', ')})` : stage.name,
      args: stage.args,
      dependencies: [`node-${index}`],
      metadata: {}
    })
  })

  const resultId = `node-${pipeline.stages.length + 1}`
  nodes.push({
    id: resultId,
    type: 'result',
    label: 'RESULT',
    args: [],
    dependencies: [`node-${pipeline.stages.length}`],
    metadata: {}
  })

  return { id: pipelineId, expression: pipeline.expression.trim(), nodes }
}

/*
 * Parses every pipeline statement in `source` and returns their graphs,
 * each with a deterministic id derived from its normalized structure.
 */
export function analyzePipelines(source) {
  return findAllPipelines(source).map(pipeline => buildGraph(pipeline))
}

export function renderGraphText(graph) {
  const lines = []

  graph.nodes.forEach((node, index) => {
    let label
    if (node.type === 'source') {
      label = `SOURCE ${node.label}`
    } else if (node.type === 'result') {
      label = 'RESULT'
    } else {
      label = node.args.length
        ? `${node.type.toUpperCase()} ${node.args.join(', ')}`
        : node.type.toUpperCase()
    }

    lines.push(label)

    if (index < graph.nodes.length - 1) {
      lines.push('      │')
      lines.push('      ▼')
    }
  })

  return lines.join('\n')
}

export function renderGraphDot(graph) {
  const lines = ['digraph pipeline {']

  for (const node of graph.nodes) {
    const dotLabel = node.args.length
      ? `${node.type}\\n${node.args.join(', ').replace(/"/g, '\\"')}`
      : node.type
    lines.push(`  "${node.id}" [label="${dotLabel}"];`)
  }

  for (const node of graph.nodes) {
    for (const dependency of node.dependencies) {
      lines.push(`  "${dependency}" -> "${node.id}";`)
    }
  }

  lines.push('}')
  return lines.join('\n')
}
