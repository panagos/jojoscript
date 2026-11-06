import { explainPipelines } from './pipeline-explain.js'

const MATERIALIZING_STAGES = new Set(['sort', 'sortBy', 'groupBy', 'partition'])
const NARROWING_STAGES = new Set(['filter', 'filterAsync', 'unique', 'distinctBy', 'take', 'skip'])

function label(stage) {
  return `stage ${stage.index} (${stage.type})`
}

function capitalize(text) {
  return text[0].toUpperCase() + text.slice(1)
}

function isEffectful(stage) {
  return stage.effects.length > 0 || stage.effectfulFunctions.length > 0
}

function uses(stage) {
  return [
    stage.effects.length ? `effect ${stage.effects.join(', ')}` : null,
    stage.effectfulFunctions.length ? `effectful function ${stage.effectfulFunctions.join(', ')}` : null
  ].filter(Boolean).join(' and ')
}

function determinism(stages) {
  const effectful = stages.filter(isEffectful)
  if (!effectful.length) {
    return {
      question: 'Why is this pipeline deterministic?',
      answer: 'No stage uses a declared effect or an effectful function. Plain JavaScript calls inside stages are not analyzed.'
    }
  }
  return {
    question: 'Why is this pipeline not deterministic?',
    answer: capitalize(`${effectful.map(stage => `${label(stage)} uses ${uses(stage)}`).join('; ')}.`)
  }
}

function laziness(stages) {
  const blocking = stages.find(stage => MATERIALIZING_STAGES.has(stage.type))
  if (!blocking) {
    return {
      question: 'Why is this pipeline lazy?',
      answer: 'Every stage passes items on one at a time, so no stage waits for the complete input.'
    }
  }
  return {
    question: 'Why is this pipeline not lazy?',
    answer: `${capitalize(label(blocking))} needs the complete input before it can emit anything.`
  }
}

function resumability(checkpoints) {
  if (!checkpoints.length) {
    return {
      question: 'Why is this pipeline not resumable?',
      answer: 'It has no checkpoint stage, so a failure restarts it from the source.'
    }
  }

  const sentences = checkpoints.map(checkpoint => {
    const repeated = checkpoint.index > 2 ? `repeating stages 2-${checkpoint.index - 1}` : 'reading the source again'
    return `Checkpoint "${checkpoint.detail}" (stage ${checkpoint.index}) saves its items once they all complete; a rerun restores them instead of ${repeated}.`
  })
  return { question: 'Why is this pipeline resumable?', answer: sentences.join(' ') }
}

function ordering(stages) {
  return stages.filter(isEffectful).flatMap(stage => stages
    .filter(narrowing => NARROWING_STAGES.has(narrowing.type) && narrowing.index < stage.index)
    .map(narrowing => ({
      question: `Why can't stage ${stage.index} be moved before stage ${narrowing.index}?`,
      answer: `${capitalize(label(stage))} uses ${uses(stage)} and ${label(narrowing)} decides which items reach it: moving it earlier would also run it for items that stage ${narrowing.index} drops.`
    })))
}

function parallelism(stages) {
  return stages
    .filter(stage => stage.type === 'parallel' && stages.some(next => next.index === stage.index + 1))
    .map(stage => {
      const next = stages.find(candidate => candidate.index === stage.index + 1)
      const concurrency = stage.args[0]
      return {
        question: `Why does stage ${stage.index} run in parallel?`,
        answer: `parallel(${concurrency}) lets up to ${concurrency} items of ${label(next)} be processed at once; results keep their input order.`
      }
    })
}

function replaySafety(stages, checkpoints) {
  const beforeCheckpoints = checkpoints.flatMap(checkpoint => {
    const effects = stages
      .filter(stage => isEffectful(stage) && stage.index < checkpoint.index)
      .flatMap(stage => [...stage.effects, ...stage.effectfulFunctions].map(name => ({ name, index: stage.index })))
    if (!effects.length) return []

    const subject = effects.length === 1
      ? `Effect ${effects[0].name} runs before it (stage ${effects[0].index})`
      : `Effects ${effects.map(effect => `${effect.name} (stage ${effect.index})`).join(' and ')} run before it`
    const pronoun = effects.length === 1 ? 'it runs' : 'they run'
    return [{
      question: `Why does checkpoint "${checkpoint.detail}" not guarantee replay safety?`,
      answer: `${subject}: if a run fails before "${checkpoint.detail}" completes, ${pronoun} again on retry (at-least-once, not exactly-once).`
    }]
  })

  const last = checkpoints.at(-1)
  const afterLast = last
    ? stages.filter(stage => isEffectful(stage) && stage.index > last.index).map(stage => ({
        question: `Why can stage ${stage.index} repeat after a failure?`,
        answer: `${capitalize(label(stage))} uses ${uses(stage)} after the last checkpoint "${last.detail}": a rerun restores the checkpoint and runs it again for every restored item.`
      }))
    : []

  return [...beforeCheckpoints, ...afterLast]
}

/*
 * Plain-language answers derived from the same static analysis as
 * `jojo explain`, using its stage numbers (the source is stage 1).
 */
export function whyPipelines(source) {
  return explainPipelines(source).map(explanation => {
    const stages = explanation.stages.slice(1)
    const checkpoints = stages.filter(stage => stage.type === 'checkpoint')

    return {
      name: explanation.name,
      answers: [
        determinism(stages),
        laziness(stages),
        resumability(checkpoints),
        ...ordering(stages),
        ...parallelism(stages),
        ...replaySafety(stages, checkpoints)
      ]
    }
  })
}

export function renderWhyText(why) {
  return [
    `WHY ${why.name}`,
    ...why.answers.flatMap(({ question, answer }) => ['', question, `→ ${answer}`])
  ].join('\n')
}
