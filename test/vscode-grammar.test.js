import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { maskNonCode } from '../src/lexer.js'

const EXTENSION = path.resolve('editors/vscode')
const grammar = JSON.parse(fs.readFileSync(path.join(EXTENSION, 'syntaxes/jojoscript.tmLanguage.json'), 'utf8'))
const examples = path.resolve('example/src')

function rule(name) {
  const found = grammar.repository[name]
  assert.ok(found, `grammar rule ${name} exists`)
  return found
}

function regex(source, flags = 'g') {
  return new RegExp(source, flags)
}

// Scope names a rule assigns to `text`; comments and strings are masked because the JavaScript grammar consumes them first.
function scopes(ruleName, text) {
  const { match, begin, captures, beginCaptures, name } = rule(ruleName)
  const pattern = regex(match ?? begin, 'gm')
  const found = []

  for (const result of maskNonCode(text).matchAll(pattern)) {
    if (name && !begin) found.push([name, result[0].trim()])
    for (const [index, capture] of Object.entries(captures ?? beginCaptures ?? {})) {
      if (result[index] !== undefined) found.push([capture.name, result[index].trim()])
    }
  }
  return found
}

function example(file) {
  return fs.readFileSync(path.join(examples, file), 'utf8')
}

test('the extension manifest points at the grammar and every grammar rule is reachable', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION, 'package.json'), 'utf8'))
  assert.equal(manifest.contributes.grammars[0].path, './syntaxes/jojoscript.tmLanguage.json')

  const included = JSON.stringify(grammar.patterns) + JSON.stringify(Object.values(grammar.repository))
  for (const name of Object.keys(grammar.repository)) {
    assert.ok(included.includes(`"#${name}"`), `rule ${name} is included somewhere`)
  }
})

test('every grammar regex compiles as a JavaScript regular expression', () => {
  const sources = JSON.stringify(grammar).match(/"(?:match|begin|end)":"(?:[^"\\]|\\.)*"/g)
  for (const entry of sources) {
    const source = JSON.parse(`{${entry}}`)
    assert.doesNotThrow(() => regex(Object.values(source)[0]), entry)
  }
})

test('named pipelines highlight the pipeline keyword, its name, and the source line', () => {
  const text = example('application/named-pipeline-example.jojo')

  assert.deepEqual(scopes('jojo-pipeline-declaration', text), [
    ['storage.modifier.export.jojo', 'export'],
    ['storage.type.pipeline.jojo', 'pipeline'],
    ['entity.name.function.pipeline.jojo', 'enrichOrders']
  ])
  assert.deepEqual(scopes('jojo-pipeline-source', text), [['keyword.other.source.jojo', 'source']])
})

test('tagged union declarations highlight the type, its variants, and their fields', () => {
  const text = example('application/tagged-unions-example.jojo')
  const { begin, end, beginCaptures, patterns } = rule('jojo-type-declaration')

  const header = text.match(regex(begin, 'm'))
  assert.equal(header[Number(Object.keys(beginCaptures).find(key => beginCaptures[key].name === 'entity.name.type.jojo'))], 'PaymentResult')
  assert.ok(regex(end, 'm').test('export fn settle(result) {'))

  const variant = patterns.find(item => item.name === 'meta.variant.jojo' || item.captures)
  const variants = [...'  | Paid(amount)\n  | Declined(reason)\n  | Pending'.matchAll(regex(variant.match))].map(match => match[1])
  assert.deepEqual(variants, ['Paid', 'Declined', 'Pending'])
})

test('constructor patterns and the wildcard arm are highlighted inside match', () => {
  const text = example('application/tagged-unions-example.jojo')

  assert.deepEqual(scopes('jojo-constructor-pattern', text).map(([, value]) => value), ['Paid', 'Declined', 'Declined', 'Pending'])
  assert.deepEqual(scopes('jojo-wildcard-arm', 'x := match y {\n  1 => "one"\n  _ => "other"\n}'), [['variable.language.wildcard.jojo', '_']])
})

test('effects, handle blocks, and purity modifiers are highlighted', () => {
  const text = example('application/purity-example.jojo')

  assert.deepEqual(scopes('jojo-effect-declaration', text), [
    ['storage.type.effect.jojo', 'effect'],
    ['entity.name.function.effect.jojo', 'storeUser']
  ])
  assert.deepEqual(scopes('jojo-handle-keyword', text), [['keyword.control.handle.jojo', 'handle']])
  assert.deepEqual(scopes('jojo-purity-modifier', text), [
    ['storage.modifier.purity.jojo', 'pure'],
    ['storage.modifier.purity.jojo', 'effectful']
  ])
})

test('contract clauses highlight requires, ensures, and result, and keep the function signature open', () => {
  const text = example('application/contracts-example.jojo')
  const { begin, patterns } = rule('jojo-contract-clause')

  const keywords = [...text.matchAll(regex(begin, 'gm'))].map(match => match[2])
  assert.deepEqual(keywords, ['requires', 'requires', 'ensures'])
  assert.ok(patterns.some(pattern => pattern.name === 'variable.language.result.jojo' && regex(pattern.match).test('result <= price')))

  const signatureEnd = regex(rule('jojo-function-signature').end)
  assert.equal(signatureEnd.test('  requires b != 0'), false)
  assert.equal(signatureEnd.test('  requires percent >= 0 && percent <= 100'), false)
  assert.equal(signatureEnd.test('{'), true)
  assert.equal(signatureEnd.test('fn double(value) = value * 2'), true)
})

test('stage IDs are highlighted after pipeline stages', () => {
  const text = example('application/stage-ids-example.jojo')
  assert.deepEqual(scopes('jojo-stage-id', text).map(([, value]) => value), ['@paid-only', '@pick-carrier', '@prepared'])
  assert.deepEqual(scopes('jojo-stage-id', 'const email = "a@b.c"'), [])
})
