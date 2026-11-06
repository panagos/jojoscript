import test from 'node:test'
import assert from 'node:assert/strict'

import { compile } from '../src/compiler.js'
import { findPurityDeclarations, findPurityViolations } from '../src/purity.js'
import { explainPipelines } from '../src/pipeline-explain.js'

test('pure and effectful modifiers compile to ordinary functions', () => {
  const annotated = compile([
    'pure fn normalize(user) { return user.name.trim() }',
    'export effectful fn saveUser(user) { return db.save(user) }',
    'export async pure fn load(id) { return id }',
    'pure fn double(value) = value * 2',
    ''
  ].join('\n'))

  const plain = compile([
    'fn normalize(user) { return user.name.trim() }',
    'export fn saveUser(user) { return db.save(user) }',
    'export async fn load(id) { return id }',
    'fn double(value) = value * 2',
    ''
  ].join('\n'))

  assert.equal(annotated, plain)
})

test('findPurityDeclarations lists each annotated function with its purity and line', () => {
  const source = '\npure fn normalize(user) { return user }\n\nexport async effectful fn saveUser(user) {\n  return user\n}\n'

  assert.deepEqual(findPurityDeclarations(source).map(({ name, purity, line }) => ({ name, purity, line })), [
    { name: 'normalize', purity: 'pure', line: 2 },
    { name: 'saveUser', purity: 'effectful', line: 4 }
  ])
})

test('a pure function may not use a declared effect or call an effectful function', () => {
  const source = [
    'effect fetchUser(id)',
    '',
    'effectful fn saveUser(user) { return user }',
    '',
    'pure fn normalize(user) {',
    '  saveUser(user)',
    '  return fetchUser(user.id)',
    '}',
    '',
    'pure fn normalizeAll(users) = users |> map(saveUser)',
    ''
  ].join('\n')

  assert.deepEqual(findPurityViolations(source), [
    { function: 'normalize', uses: 'saveUser', kind: 'effectful function', line: 6 },
    { function: 'normalize', uses: 'fetchUser', kind: 'effect', line: 7 },
    { function: 'normalizeAll', uses: 'saveUser', kind: 'effectful function', line: 10 }
  ])
  assert.throws(() => compile(source), {
    name: 'SyntaxError',
    message: 'pure fn "normalize" uses effectful function "saveUser" (line 6)'
  })
})

test('purity checks ignore method calls, strings, comments, and recursion', () => {
  const source = [
    'effect saveUser(user)',
    '',
    'pure fn describe(user, depth) {',
    '  // saveUser is mentioned only in this comment',
    '  const label = "saveUser"',
    '  return depth ? describe(user, depth - 1) : user.saveUser + label',
    '}',
    '',
    'effectful fn persist(user) { return saveUser(user) }',
    ''
  ].join('\n')

  assert.deepEqual(findPurityViolations(source), [])
  assert.doesNotThrow(() => compile(source))
})

test('identifiers named pure or effectful are left untouched', () => {
  assert.equal(compile('const pure = true\nconst effectful = pure && false\n'), 'const pure = true\nconst effectful = pure && false\n')
})

test('explain treats stages that use effectful functions as effectful', () => {
  const [explanation] = explainPipelines([
    'pure fn normalize(user) { return user }',
    'effectful fn saveUser(user) { return user }',
    '',
    'saved := users |> map(normalize) |> map(saveUser)',
    ''
  ].join('\n'))

  assert.deepEqual(explanation.stages.slice(1).map(stage => stage.detail), ['pure', 'effectful: saveUser'])
  assert.deepEqual(explanation.stages[2].effectfulFunctions, ['saveUser'])
  assert.equal(explanation.properties.deterministic, false)
  assert.deepEqual(explanation.effects, [])
})
