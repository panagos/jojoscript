import { findAllPipelines } from './pipeline-parser.js'
import { computePipelineId } from './pipeline-hash.js'
import { findEffectDeclarations, findHandleBlocks } from './effect-parser.js'

/*
 * Best-effort, purely textual check for whether `effectName` is referenced
 * anywhere in a stage's call (its name or its argument expressions), e.g.
 * `map(user => fetchUser(user.id))` or a bare `saveUser` stage. This is
 * static analysis over source text, not evaluation — it cannot tell
 * whether the reference is actually reachable/called, only that the name
 * appears with word boundaries.
 */
function effectsUsedByStage(stage, effectNames) {
  if (!effectNames.length) return []
  const haystack = stage.args.length ? `${stage.name} ${stage.args.join(' ')}` : stage.name
  return effectNames.filter(name => new RegExp(`\\b${name}\\b`).test(haystack))
}

/*
 * Static, execution-free representation of a pipeline: SOURCE, one node per
 * stage, RESULT, chained by `dependencies`. Used by `jojo graph` (pure
 * text/DOT rendering, no execution) and correlated at runtime with
 * `jojo profile`'s collected metrics via the same `node-<n>` id scheme the
 * compiler uses when emitting code (see `pipeline-parser.js`'s
 * `emitPipeline`).
 *
 * `options.effectNames`/`options.handledEffectNames` (both plain arrays of
 * effect names) let callers surface effect usage per node (`jojo graph`
 * passes the whole file's `effect name(...)` declarations and any
 * statically-visible `handle { name: ... }` keys) — see `analyzePipelines`.
 */
export function buildGraph(pipeline, pipelineId = computePipelineId(pipeline), options = {}) {
  const effectNames = options.effectNames ?? []
  const handledEffectNames = new Set(options.handledEffectNames ?? [])
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
    const effects = effectsUsedByStage(stage, effectNames)

    nodes.push({
      id: `node-${index + 1}`,
      type: stage.name,
      label: stage.args.length ? `${stage.name}(${stage.args.join(', ')})` : stage.name,
      args: stage.args,
      dependencies: [`node-${index}`],
      metadata: effects.length ? { effects } : {}
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

  /*
   * Per-effect summary across the whole pipeline: name, which node(s)
   * reference it, and a best-effort static "handled" signal — true only
   * if a `handle { name: ... }` block naming this effect was found
   * anywhere in the same file. A statically-declared handle block that is
   * conditionally executed, or a handler installed dynamically at
   * runtime, cannot be seen here; this is inspection, not proof.
   */
  const effects = nodes
    .filter(node => node.metadata.effects?.length)
    .flatMap(node => node.metadata.effects.map(name => ({
      name,
      nodeId: node.id,
      staticallyHandled: handledEffectNames.has(name)
    })))

  return { id: pipelineId, expression: pipeline.expression.trim(), nodes, effects }
}

/*
 * Parses every pipeline statement in `source` and returns their graphs,
 * each with a deterministic id derived from its normalized structure. Also
 * scans `source` for `effect name(...)` declarations and `handle { ... }`
 * handler-map keys, so returned graphs can expose which effects each
 * pipeline uses and whether a handler for them is statically visible.
 */
export function analyzePipelines(source) {
  const effectNames = findEffectDeclarations(source).map(declaration => declaration.name)
  const handledEffectNames = findHandleBlocks(source).flatMap(block => block.handlerNames)

  return findAllPipelines(source).map(pipeline =>
    buildGraph(pipeline, undefined, { effectNames, handledEffectNames })
  )
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

    if (node.metadata.effects?.length) {
      label += `  [effects: ${node.metadata.effects.join(', ')}]`
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
    let dotLabel = node.args.length
      ? `${node.type}\\n${node.args.join(', ').replace(/"/g, '\\"')}`
      : node.type

    if (node.metadata.effects?.length) {
      dotLabel += `\\n[effects: ${node.metadata.effects.join(', ')}]`
    }

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
