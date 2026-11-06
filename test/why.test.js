import test from 'node:test'
import assert from 'node:assert/strict'

import { whyPipelines, renderWhyText } from '../src/why.js'
import { whyPipelines as exportedWhyPipelines } from '../src/index.js'

const SOURCE = `
effect fetchCustomer(id)
effectful fn persist(order) { return order }

pipeline enrichOrders {
  source orders
  |> filter(order => order.paid)
  |> parallel(8)
  |> map(order => fetchCustomer(order.customerId))
  |> checkpoint("enriched")
  |> map(persist)
}
`

test('why answers questions about determinism, laziness, resumability, ordering, parallelism, and replay safety', () => {
  const [why] = whyPipelines(SOURCE)

  assert.equal(why.name, 'enrichOrders')
  assert.deepEqual(why.answers, [
    {
      question: 'Why is this pipeline not deterministic?',
      answer: 'Stage 4 (map) uses effect fetchCustomer; stage 6 (map) uses effectful function persist.'
    },
    {
      question: 'Why is this pipeline lazy?',
      answer: 'Every stage passes items on one at a time, so no stage waits for the complete input.'
    },
    {
      question: 'Why is this pipeline resumable?',
      answer: 'Checkpoint "enriched" (stage 5) saves its items once they all complete; a rerun restores them instead of repeating stages 2-4.'
    },
    {
      question: 'Why can\'t stage 4 be moved before stage 2?',
      answer: 'Stage 4 (map) uses effect fetchCustomer and stage 2 (filter) decides which items reach it: moving it earlier would also run it for items that stage 2 drops.'
    },
    {
      question: 'Why can\'t stage 6 be moved before stage 2?',
      answer: 'Stage 6 (map) uses effectful function persist and stage 2 (filter) decides which items reach it: moving it earlier would also run it for items that stage 2 drops.'
    },
    {
      question: 'Why does stage 3 run in parallel?',
      answer: 'parallel(8) lets up to 8 items of stage 4 (map) be processed at once; results keep their input order.'
    },
    {
      question: 'Why does checkpoint "enriched" not guarantee replay safety?',
      answer: 'Effect fetchCustomer runs before it (stage 4): if a run fails before "enriched" completes, it runs again on retry (at-least-once, not exactly-once).'
    },
    {
      question: 'Why can stage 6 repeat after a failure?',
      answer: 'Stage 6 (map) uses effectful function persist after the last checkpoint "enriched": a rerun restores the checkpoint and runs it again for every restored item.'
    }
  ])
})

test('pure, eager, unresumable pipelines get the opposite answers', () => {
  const [why] = whyPipelines('names := users |> map(user => user.name) |> sort\n')

  assert.deepEqual(why.answers, [
    {
      question: 'Why is this pipeline deterministic?',
      answer: 'No stage uses a declared effect or an effectful function. Plain JavaScript calls inside stages are not analyzed.'
    },
    {
      question: 'Why is this pipeline not lazy?',
      answer: 'Stage 3 (sort) needs the complete input before it can emit anything.'
    },
    {
      question: 'Why is this pipeline not resumable?',
      answer: 'It has no checkpoint stage, so a failure restarts it from the source.'
    }
  ])
})

test('renderWhyText prints each question with its answer', () => {
  const text = renderWhyText(whyPipelines('names := users |> map(user => user.name) |> sort\n')[0])

  assert.equal(text, [
    'WHY names',
    '',
    'Why is this pipeline deterministic?',
    '→ No stage uses a declared effect or an effectful function. Plain JavaScript calls inside stages are not analyzed.',
    '',
    'Why is this pipeline not lazy?',
    '→ Stage 3 (sort) needs the complete input before it can emit anything.',
    '',
    'Why is this pipeline not resumable?',
    '→ It has no checkpoint stage, so a failure restarts it from the source.'
  ].join('\n'))
})

test('whyPipelines is exported from the compiler entry point', () => {
  assert.equal(exportedWhyPipelines, whyPipelines)
})

test('several effects before a checkpoint, and a checkpoint right after the source, are explained', () => {
  const source = [
    'effect load(id)',
    'effect score(row)',
    '',
    'r := ids |> checkpoint("ids") |> map(load) |> map(score) |> checkpoint("scored")',
    ''
  ].join('\n')
  const answers = Object.fromEntries(whyPipelines(source)[0].answers.map(({ question, answer }) => [question, answer]))

  assert.equal(answers['Why is this pipeline resumable?'],
    'Checkpoint "ids" (stage 2) saves its items once they all complete; a rerun restores them instead of reading the source again. ' +
    'Checkpoint "scored" (stage 5) saves its items once they all complete; a rerun restores them instead of repeating stages 2-4.')
  assert.equal(answers['Why does checkpoint "scored" not guarantee replay safety?'],
    'Effects load (stage 3) and score (stage 4) run before it: if a run fails before "scored" completes, they run again on retry (at-least-once, not exactly-once).')
  assert.equal(answers['Why does checkpoint "ids" not guarantee replay safety?'], undefined)
})

test('a trailing parallel stage has no stage to parallelize and is not explained', () => {
  const questions = whyPipelines('r := xs |> parallel(4)\n')[0].answers.map(answer => answer.question)
  assert.ok(!questions.some(question => question.includes('parallel')))
})
