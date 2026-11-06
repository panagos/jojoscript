import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { compile } from '../src/compiler.js'
import { findNamedPipelines, transformNamedPipelines } from '../src/named-pipelines.js'
import { analyzePipelines } from '../src/pipeline-ir.js'
import { explainPipelines } from '../src/pipeline-explain.js'
import { planPipelines } from '../src/pipeline-plan.js'

const RUNTIME = pathToFileURL(path.resolve('src/runtime/index.js')).href

async function evaluate(source) {
  return import(`data:text/javascript,${encodeURIComponent(compile(source, { runtimeImport: RUNTIME }))}`)
}

const SOURCE = `
export pipeline activeNames {
  source users

  |> filter(user => user.active)
  |> map(user => user.name)
  |> toArray
}

after := 1
`

test('a named pipeline compiles to a function whose parameter is its source', async () => {
  const { activeNames } = await evaluate(SOURCE)
  assert.deepEqual(activeNames([{ name: 'Ada', active: true }, { name: 'Bob', active: false }]), ['Ada'])
})

test('the transform keeps the block line count so later lines do not shift', () => {
  const transformed = transformNamedPipelines(SOURCE)

  assert.match(transformed, /^export fn activeNames\(users\) \{\n {2}return users\n {2}\|> filter/m)
  assert.equal(transformed.split('\n').length, SOURCE.split('\n').length)
  assert.equal(transformed.split('\n').indexOf('after := 1'), SOURCE.split('\n').indexOf('after := 1'))
})

test('pipelines that await become async functions, and expression sources take no inputs', async () => {
  const { loadIds } = await evaluate(`
export pipeline loadIds {
  source Promise.resolve([3, 1, 2])
  |> await
  |> sort((a, b) => a - b)
}
`)
  assert.deepEqual(await loadIds(), [1, 2, 3])
})

test('findNamedPipelines describes each declaration', () => {
  assert.deepEqual(findNamedPipelines(SOURCE).map(({ name, inputs, exported, line }) => ({ name, inputs, exported, line })), [
    { name: 'activeNames', inputs: ['users'], exported: true, line: 2 }
  ])
})

test('graph, explain, and plan see a named pipeline under its name', () => {
  assert.equal(analyzePipelines(SOURCE)[0].expression, 'users')
  assert.equal(explainPipelines(SOURCE)[0].name, 'activeNames')
  assert.equal(planPipelines(SOURCE).pipelines[0].pipeline, 'activeNames')
})

test('a named pipeline must start with a source line and contain stages', () => {
  assert.throws(() => compile('pipeline broken {\n  |> map(f)\n}\n'), /pipeline "broken" must start with "source <expression>"/)
  assert.throws(() => compile('pipeline empty {\n  source items\n}\n'), /pipeline "empty" has no stages/)
})

test('ordinary uses of the word pipeline are left untouched', () => {
  const source = 'const pipeline = { stages: [] }\npipeline.stages.push(1)\n'
  assert.equal(transformNamedPipelines(source), source)
})
