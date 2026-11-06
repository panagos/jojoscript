import { maskNonCode } from './lexer.js'
import { findAllPipelines } from './pipeline-parser.js'
import { analyzePipelines } from './pipeline-ir.js'

const CONTROL_STAGES = new Set(['await', 'catch', 'orElse', 'pass'])
const MATERIALIZING_STAGES = new Set(['sort', 'sortBy', 'groupBy', 'partition'])

const ASSIGNED_NAME = /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*(?::=|=|:)$/
const EXPRESSION_FUNCTION_NAME = /\bfn\s+([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*=$/
const FUNCTION_NAME = /\b(?:fn|function)\s+([A-Za-z_$][\w$]*)\s*\(/g

/*
 * A static, execution-free description of what each pipeline in `source`
 * means, built on the same graph as `jojo graph`. Purity and determinism
 * only reflect references to declared effects; ordinary JavaScript calls
 * inside a stage are not analyzed.
 */
export function explainPipelines(source) {
  const pipelines = findAllPipelines(source)

  return analyzePipelines(source).map((graph, index) => {
    const stages = graph.nodes
      .filter(node => node.type !== 'result')
      .map((node, position) => describeStage(node, position + 1))

    return {
      name: inferName(source, pipelines[index]) ?? `pipeline-${index + 1}`,
      id: graph.id,
      stages,
      effects: uniqueEffects(graph.effects),
      properties: {
        lazy: !stages.some(stage => MATERIALIZING_STAGES.has(stage.type)),
        parallel: stages.some(stage => stage.type === 'parallel'),
        resumable: stages.some(stage => stage.type === 'checkpoint'),
        deterministic: graph.effects.length === 0
      }
    }
  })
}

function describeStage(node, index) {
  const effects = node.metadata.effects ?? []
  return { index, type: node.type, detail: stageDetail(node, effects), args: node.args, effects }
}

function stageDetail(node, effects) {
  if (node.type === 'source') return node.label
  if (CONTROL_STAGES.has(node.type)) return 'control'
  if (node.type === 'parallel') return `concurrency=${node.args[0]}`
  if (node.type === 'batch') return `size=${node.args[0]}`
  if (node.type === 'checkpoint') return node.args[0].replace(/^(["'`])(.*)\1$/, '$2')
  return effects.length ? `effectful: ${effects.join(', ')}` : 'pure'
}

function uniqueEffects(effects) {
  const byName = new Map()
  for (const { name, staticallyHandled } of effects) {
    if (!byName.has(name)) byName.set(name, { name, staticallyHandled })
  }
  return [...byName.values()]
}

function inferName(source, pipeline) {
  const lead = (source.slice(0, pipeline.start) + pipeline.prefix).trimEnd()

  const expressionFunction = lead.match(EXPRESSION_FUNCTION_NAME)
  if (expressionFunction) return expressionFunction[1]

  if (pipeline.prefix === 'return') return enclosingFunctionName(source, pipeline.start)

  return lead.match(ASSIGNED_NAME)?.[1] ?? null
}

function enclosingFunctionName(source, position) {
  const code = maskNonCode(source).slice(0, position)
  const candidates = [...code.matchAll(FUNCTION_NAME)].reverse()

  const enclosing = candidates.find(match => !bodyClosesWithin(code, match.index))
  return enclosing?.[1] ?? null
}

function bodyClosesWithin(code, functionStart) {
  const bodyStart = code.indexOf('{', functionStart)
  if (bodyStart === -1) return true

  let depth = 0
  for (let i = bodyStart; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}' && --depth === 0) return true
  }
  return false
}

export function renderExplanationText(explanation) {
  const width = Math.max(...explanation.stages.map(stage => stage.type.length))
  const effects = explanation.effects.length
    ? explanation.effects.map(effect =>
      `  ${effect.name} (${effect.staticallyHandled ? 'handler declared' : 'no handler in file'})`)
    : ['  none']

  return [
    `PIPELINE ${explanation.name}`,
    '',
    'STAGES',
    ...explanation.stages.map(stage => `  ${stage.index} ${stage.type.padEnd(width)} ${stage.detail}`),
    '',
    'EFFECTS',
    ...effects,
    '',
    'PROPERTIES',
    ...Object.entries(explanation.properties).map(([name, value]) => `  ${name}: ${value}`)
  ].join('\n')
}
