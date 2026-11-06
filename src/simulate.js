import { explainPipelines } from './pipeline-explain.js'

const DEFAULT_INPUT = 1000
const EFFECT_VOLUME_WARNING = 1000
const MEMORY_WARNING = 10000

const NARROWING_STAGES = new Set(['filter', 'filterAsync', 'unique', 'distinctBy'])
const SINGLE_RESULT_STAGES = new Set(['count', 'first', 'find', 'some', 'every', 'reduce'])
const MATERIALIZING_STAGES = new Set(['sort', 'sortBy', 'groupBy', 'partition'])

function integerArgument(stage) {
  return /^\d+$/.test(stage.args[0] ?? '') ? Number(stage.args[0]) : null
}

/*
 * Upper bound on the items a stage emits, given the items it receives.
 * `null` means the count cannot be known statically.
 */
function itemsOut(stage, items) {
  if (items === null) return SINGLE_RESULT_STAGES.has(stage.type) ? 1 : null
  const size = integerArgument(stage)

  switch (stage.type) {
    case 'take': return size === null ? null : Math.min(size, items)
    case 'skip': return size === null ? null : Math.max(items - size, 0)
    case 'chunk':
    case 'batch': return size === null ? null : Math.ceil(items / size)
    case 'window': return size === null ? null : Math.max(items - size + 1, 0)
    case 'flatMap':
    case 'groupBy': return null
    case 'partition': return 2
    default: return SINGLE_RESULT_STAGES.has(stage.type) ? 1 : items
  }
}

function exactOut(stage, exact) {
  return exact && !NARROWING_STAGES.has(stage.type)
}

function format(items, exact) {
  if (items === null) return 'unknown'
  return `${exact ? '' : '≤'}${items.toLocaleString('en-US')}`
}

function simulateStages(explanation, input) {
  let items = input
  let exact = true

  return explanation.stages.slice(1).map(stage => {
    const effects = [...stage.effects, ...stage.effectfulFunctions]
    const simulated = {
      index: stage.index,
      id: stage.id,
      type: stage.type,
      items,
      exact,
      workers: stage.type === 'parallel' ? integerArgument(stage) : null,
      effectCalls: Object.fromEntries(effects.map(name => [name, items])),
      checkpoint: stage.type === 'checkpoint' ? stage.detail : null
    }

    exact = exactOut(stage, exact)
    items = itemsOut(stage, items)
    return simulated
  })
}

function findProblems(stages) {
  const problems = []
  const checkpoints = stages.filter(stage => stage.checkpoint)

  for (const stage of stages) {
    if (MATERIALIZING_STAGES.has(stage.type) && stage.items >= MEMORY_WARNING) {
      const amount = stage.exact ? `all ${format(stage.items, true)}` : `up to ${format(stage.items, true)}`
      problems.push({ stage: stage.index, message: `${stage.type} holds ${amount} items in memory before continuing` })
    }

    for (const [name, calls] of Object.entries(stage.effectCalls)) {
      if (calls !== null && calls >= EFFECT_VOLUME_WARNING) {
        problems.push({ stage: stage.index, message: `up to ${format(calls, true)} calls to effect "${name}"` })
      }

      const nextCheckpoint = checkpoints.find(checkpoint => checkpoint.index > stage.index)
      if (nextCheckpoint) {
        problems.push({
          stage: stage.index,
          message: `effect "${name}" runs before checkpoint "${nextCheckpoint.checkpoint}": items processed before a failure are fetched again on retry (at-least-once)`
        })
      }
    }
  }

  if (!checkpoints.length && stages.some(stage => Object.keys(stage.effectCalls).length)) {
    problems.push({ stage: null, message: 'pipeline has effects but no checkpoint: a failure re-runs every effect from the start' })
  }

  return problems
}

function totalEffectCalls(stages) {
  const totals = {}
  for (const stage of stages) {
    for (const [name, calls] of Object.entries(stage.effectCalls)) {
      totals[name] = name in totals && (totals[name] === null || calls === null) ? null : (totals[name] ?? 0) + calls
    }
  }
  return totals
}

/*
 * A static what-if for `input` records: no stage or effect is executed.
 * Counts are upper bounds once a filtering stage has run.
 */
export function simulatePipelines(source, options = {}) {
  const input = options.input ?? DEFAULT_INPUT

  return explainPipelines(source).map(explanation => {
    const stages = simulateStages(explanation, input)
    return {
      name: explanation.name,
      input,
      stages,
      effectCalls: totalEffectCalls(stages),
      checkpoints: stages.filter(stage => stage.checkpoint).length,
      problems: findProblems(stages)
    }
  })
}

function describeOperation(stage) {
  const parts = [`${format(stage.items, stage.exact)} items in`]
  if (stage.workers !== null) parts.push(`${stage.workers} workers`)
  for (const [name, calls] of Object.entries(stage.effectCalls)) parts.push(`${format(calls, stage.exact)} calls to ${name}`)
  if (stage.checkpoint) parts.push(`saved as "${stage.checkpoint}"`)
  return parts.join(', ') + (stage.id ? ` @${stage.id}` : '')
}

export function renderSimulationText(simulation) {
  const width = Math.max(...simulation.stages.map(stage => stage.type.length))
  const problems = simulation.problems.length
    ? simulation.problems.map(problem => `  ⚠ ${problem.stage === null ? '' : `stage ${problem.stage}: `}${problem.message}`)
    : ['  none']

  return [
    `SIMULATION ${simulation.name}`,
    '',
    'INPUT',
    `  ${simulation.input.toLocaleString('en-US')} records`,
    '',
    'OPERATIONS',
    ...simulation.stages.map(stage => `  ${stage.index} ${stage.type.padEnd(width)} ${describeOperation(stage)}`),
    '',
    'POTENTIAL PROBLEMS',
    ...problems
  ].join('\n')
}
