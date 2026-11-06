import { explainPipelines } from './pipeline-explain.js'
import { planPipelines } from './pipeline-plan.js'
import { findEffectDeclarations, findHandleBlocks } from './effect-parser.js'
import { findPurityDeclarations } from './purity.js'
import { findContracts } from './contracts.js'
import { findTypeDeclarations } from './type-declarations.js'

const DESCRIPTION_VERSION = '1'

/*
 * One self-describing JSON document for a source file, assembled from the
 * same analyses as `explain`, `plan`, and `check` so they never disagree.
 */
export function describeSource(source) {
  const plans = planPipelines(source).pipelines

  return {
    language: 'jojo',
    version: DESCRIPTION_VERSION,
    pipelines: explainPipelines(source).map((explanation, index) => describePipeline(explanation, plans[index])),
    effects: describeEffects(source),
    functions: describeFunctions(source),
    types: findTypeDeclarations(source).map(({ name, variants }) => ({ name, variants }))
  }
}

function describePipeline(explanation, plan) {
  const [source, ...stages] = explanation.stages
  const effects = stages.flatMap(stage => [...stage.effects, ...stage.effectfulFunctions])

  return {
    name: explanation.name,
    inputs: /^[A-Za-z_$][\w$]*$/.test(source.detail) ? [source.detail] : [],
    effects: [...new Set(effects)],
    stages: stages.map((stage, index) => {
      const { type, id, ...fields } = plan.stages[index + 1]
      return { id: stage.id ?? `node-${stage.index - 1}`, operation: type, ...fields }
    }),
    properties: explanation.properties
  }
}

function describeEffects(source) {
  const handled = new Set(findHandleBlocks(source).flatMap(block => block.handlerNames))
  return findEffectDeclarations(source).map(({ name, params }) => ({ name, params, handled: handled.has(name) }))
}

function describeFunctions(source) {
  const functions = new Map()
  const entry = (name, line) => {
    if (!functions.has(name)) functions.set(name, { name, line, purity: null, requires: [], ensures: [] })
    return functions.get(name)
  }

  for (const { name, line, purity } of findPurityDeclarations(source)) entry(name, line).purity = purity
  for (const { name, line, requires, ensures } of findContracts(source)) {
    const described = entry(name, line)
    described.requires = requires.map(clause => clause.condition)
    described.ensures = ensures.map(clause => clause.condition)
  }

  return [...functions.values()].sort((a, b) => a.line - b.line)
}
