import { compile } from './compiler.js'
import { findAllPipelines, STAGE_ID } from './pipeline-parser.js'
import { computePipelineId } from './pipeline-hash.js'
import { inferPipelineName } from './pipeline-explain.js'

const PLAN_VERSION = 1

const EXPRESSION_STAGES = new Set([
  'map', 'filter', 'flatMap', 'tap', 'mapAsync', 'filterAsync', 'find', 'some',
  'every', 'sortBy', 'distinctBy', 'groupBy', 'partition', 'catch'
])

const INTEGER_STAGE_FIELDS = { parallel: 'concurrency', batch: 'size' }

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
const STAGE_NAME = /^\.?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/
const SIMPLE_STRING = /^(["'])([^"'\\]*)\1$/

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

class PlanValidationError extends Error {
  constructor(message) {
    super(`Invalid plan: ${message}`)
    this.name = 'PlanValidationError'
  }
}

/*
 * The canonical, machine-readable form of every pipeline in `source`.
 * Arguments stay as source text, so the plan describes computation without
 * evaluating it and `planToJojo` can reproduce it.
 */
export function planPipelines(source) {
  return {
    version: PLAN_VERSION,
    pipelines: findAllPipelines(source).map(pipeline => ({
      pipeline: inferPipelineName(source, pipeline),
      id: computePipelineId(pipeline),
      stages: [{ type: 'source', expression: pipeline.expression }, ...pipeline.stages.map(planStage)]
    }))
  }
}

function planStage(stage) {
  const planned = plannedStage(stage)
  return stage.id ? { ...planned, id: stage.id } : planned
}

function plannedStage(stage) {
  const { name: type, args } = stage
  const integerField = INTEGER_STAGE_FIELDS[type]

  if (integerField && args.length === 1 && /^[1-9]\d*$/.test(args[0])) {
    return { type, [integerField]: Number(args[0]) }
  }
  if (type === 'checkpoint' && args.length === 1 && SIMPLE_STRING.test(args[0])) {
    return { type, name: args[0].match(SIMPLE_STRING)[2] }
  }
  if (EXPRESSION_STAGES.has(type) && args.length === 1) {
    return { type, expression: args[0] }
  }
  if (stage.propertyCall || args.length) return { type, args }
  return { type }
}

export function planToJojo(plan) {
  validatePlan(plan)

  return plan.pipelines.map((pipeline, index) => {
    const source = emitPipeline(pipeline)
    assertCompiles(source, `pipelines[${index}]`)
    return source
  }).join('\n\n') + '\n'
}

function emitPipeline({ pipeline, stages: [source, ...stages] }) {
  const head = pipeline ? `${pipeline} := ${source.expression}` : source.expression
  return [head, ...stages.map(stage => `  |> ${emitStage(stage)}`)].join('\n')
}

function emitStage(stage) {
  const args = stageArgs(stage)
  const call = args ? `${stage.type}(${args.join(', ')})` : stage.type
  return stage.id ? `${call} @${stage.id}` : call
}

function stageArgs(stage) {
  if ('expression' in stage) return [stage.expression]
  if ('name' in stage) return [JSON.stringify(stage.name)]
  if ('concurrency' in stage) return [String(stage.concurrency)]
  if ('size' in stage) return [String(stage.size)]
  return stage.args ?? null
}

// Building the function only parses the generated code; it is never called.
function assertCompiles(source, path) {
  const compiled = compile(source).replace(/^import .*\n/, '')
  try {
    new AsyncFunction(compiled)
  } catch (error) {
    throw new PlanValidationError(`${path} does not compile to valid JavaScript (${error.message})`)
  }
}

function validatePlan(plan) {
  if (!isObject(plan)) throw new PlanValidationError('plan must be an object')
  assertKnownFields(plan, ['version', 'pipelines'], '')
  if (plan.version !== PLAN_VERSION) throw new PlanValidationError(`version must be ${PLAN_VERSION}`)
  if (!Array.isArray(plan.pipelines)) throw new PlanValidationError('pipelines must be an array')

  const names = new Set()
  plan.pipelines.forEach((pipeline, index) => {
    const path = `pipelines[${index}]`
    if (!isObject(pipeline)) throw new PlanValidationError(`${path} must be an object`)
    assertKnownFields(pipeline, ['pipeline', 'id', 'stages'], path)

    if (pipeline.pipeline !== null && !IDENTIFIER.test(pipeline.pipeline ?? '')) {
      throw new PlanValidationError(`${path}.pipeline must be an identifier or null`)
    }
    if (names.has(pipeline.pipeline)) {
      throw new PlanValidationError(`${path}.pipeline "${pipeline.pipeline}" is already declared`)
    }
    if (pipeline.pipeline) names.add(pipeline.pipeline)

    if (!Array.isArray(pipeline.stages) || !pipeline.stages.length) {
      throw new PlanValidationError(`${path}.stages must be a non-empty array`)
    }
    const stageIds = new Set()
    pipeline.stages.forEach((stage, stageIndex) => {
      const stagePath = `${path}.stages[${stageIndex}]`
      validateStage(stage, stageIndex, stagePath)
      if (stage.id === undefined) return
      if (stageIds.has(stage.id)) throw new PlanValidationError(`${stagePath}.id "${stage.id}" is already used in this pipeline`)
      stageIds.add(stage.id)
    })
  })
}

function validateStage(stage, index, path) {
  if (!isObject(stage)) throw new PlanValidationError(`${path} must be an object`)

  if (index === 0) {
    if (stage.type !== 'source') throw new PlanValidationError(`${path} must be a source stage`)
    assertKnownFields(stage, ['type', 'expression'], path)
    assertNonEmptyString(stage.expression, `${path}.expression`)
    return
  }

  if (stage.type === 'source') throw new PlanValidationError(`${path} must not be a source stage`)
  if (typeof stage.type !== 'string' || !STAGE_NAME.test(stage.type)) {
    throw new PlanValidationError(`${path}.type must be a stage name such as "map" or ".trim"`)
  }

  const fields = allowedFields(stage.type)
  assertKnownFields(stage, ['type', 'id', ...fields], path)
  if (stage.id !== undefined && (typeof stage.id !== 'string' || !STAGE_ID.test(stage.id))) {
    throw new PlanValidationError(`${path}.id must be a stage id such as "enrich"`)
  }

  const used = fields.filter(field => field in stage)
  if (used.length > 1) {
    throw new PlanValidationError(`${path} must use only one of ${used.map(field => `"${field}"`).join(' or ')}`)
  }

  const [field] = used
  if (field === 'concurrency' || field === 'size') {
    if (!Number.isInteger(stage[field]) || stage[field] <= 0) {
      throw new PlanValidationError(`${path}.${field} must be a positive integer`)
    }
  } else if (field === 'args') {
    if (!Array.isArray(stage.args) || !stage.args.every(arg => typeof arg === 'string' && arg.trim())) {
      throw new PlanValidationError(`${path}.args must be an array of non-empty strings`)
    }
  } else if (field) {
    assertNonEmptyString(stage[field], `${path}.${field}`)
  }
}

function allowedFields(type) {
  if (INTEGER_STAGE_FIELDS[type]) return [INTEGER_STAGE_FIELDS[type], 'args']
  if (type === 'checkpoint') return ['name', 'args']
  if (EXPRESSION_STAGES.has(type)) return ['expression', 'args']
  return ['args']
}

function assertKnownFields(value, fields, path) {
  const unknown = Object.keys(value).find(key => !fields.includes(key))
  if (unknown) {
    throw new PlanValidationError(path ? `${path} has unknown field "${unknown}"` : `unknown field "${unknown}"`)
  }
}

function assertNonEmptyString(value, path) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PlanValidationError(`${path} must be a non-empty string`)
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
