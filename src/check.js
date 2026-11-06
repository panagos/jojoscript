import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { compile } from './compiler.js'
import { maskNonCode, tokenize } from './lexer.js'
import { findEffectDeclarations, findHandleBlocks } from './effect-parser.js'
import { findPurityViolations } from './purity.js'
import { findContracts } from './contracts.js'
import { findTypeDeclarations } from './type-declarations.js'
import { findMatchExpressions } from './match-parser.js'
import { planToJojo } from './pipeline-plan.js'

const LITERAL_KEYWORDS = { true: true, false: false, null: null, undefined }
const CONDITION_KEYWORDS = new Set(['typeof', ...Object.keys(LITERAL_KEYWORDS)])

function diagnostic(code, line, message, suggestion) {
  return { code, severity: code.startsWith('W') ? 'warning' : 'error', line, message, suggestion }
}

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length
}

function nameUsage(name) {
  return new RegExp(`(?<![.\\w$])${name}(?![\\w$])`, 'g')
}

// Static analyses skip code they cannot parse; the compiler then reports it as E100.
function analyze(fn) {
  try {
    return fn()
  } catch {
    return []
  }
}

function missingHandlers(source) {
  const code = maskNonCode(source)
  const handled = new Set(findHandleBlocks(source).flatMap(block => block.handlerNames))

  return findEffectDeclarations(source)
    .filter(effect => !handled.has(effect.name))
    .flatMap(effect => {
      const use = [...code.matchAll(nameUsage(effect.name))]
        .find(match => match.index < effect.start || match.index >= effect.end)
      if (!use) return []

      return [diagnostic(
        'W102',
        lineAt(source, use.index),
        `Effect "${effect.name}" has no handler in this file`,
        `Add a handler for "${effect.name}" in a handle { ... } block, or make sure every caller installs one`
      )]
    })
}

function purityErrors(source) {
  return findPurityViolations(source).map(violation => diagnostic(
    'E201',
    violation.line,
    `pure fn "${violation.function}" uses ${violation.kind} "${violation.uses}"`,
    `Remove the use of "${violation.uses}" from "${violation.function}", or declare "${violation.function}" as effectful fn`
  ))
}

function literalValue(text) {
  if (/^-?\d+(\.\d+)?$/.test(text)) return { value: Number(text) }
  const string = text.match(/^(["'])([^"'\\]*)\1$/)
  if (string) return { value: string[2] }
  if (Object.hasOwn(LITERAL_KEYWORDS, text)) return { value: LITERAL_KEYWORDS[text] }
  return null
}

function splitArguments(text) {
  const result = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if ('([{'.includes(text[i])) depth++
    else if (')]}'.includes(text[i])) depth--
    else if (text[i] === ',' && depth === 0) {
      result.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  if (text.trim()) result.push(text.slice(start).trim())
  return result
}

/*
 * A condition is evaluated only when it is built from parameters, literals,
 * and operators: no property access, indexing, calls, or other names, so
 * checking never runs user code.
 */
function evaluableCondition(condition, params) {
  const tokens = tokenize(condition)
  return tokens.every((token, index) => {
    if (token.type === 'identifier') return params.includes(token.value) || CONDITION_KEYWORDS.has(token.value)
    if (['.', '[', '?.', '=>'].includes(token.value)) return false
    return !(token.value === '(' && tokens[index - 1]?.type === 'identifier')
  })
}

function contractViolations(source) {
  const code = maskNonCode(source)

  return findContracts(source).flatMap(contract => [...code.matchAll(new RegExp(`(?<![.\\w$])${contract.name}\\s*\\(`, 'g'))]
    .filter(call => !/\bfn\s+$/.test(code.slice(Math.max(0, call.index - 10), call.index)))
    .flatMap(call => {
      const open = call.index + call[0].length - 1
      let depth = 0
      let close = open
      for (; close < code.length; close++) {
        if (code[close] === '(') depth++
        else if (code[close] === ')' && --depth === 0) break
      }

      const literals = splitArguments(source.slice(open + 1, close)).map(literalValue)
      if (literals.length !== contract.params.length || literals.some(literal => !literal)) return []

      const values = literals.map(literal => literal.value)
      const broken = contract.requires.find(({ condition }) =>
        evaluableCondition(condition, contract.params) &&
        !new Function(...contract.params, `return (${condition})`)(...values))
      if (!broken) return []

      return [diagnostic(
        'E301',
        lineAt(source, call.index),
        `Call ${source.slice(call.index, close + 1)} violates "requires ${broken.condition}"`,
        `Pass arguments to "${contract.name}" that satisfy ${broken.condition}`
      )]
    }))
}

function matchErrors(source) {
  const variants = new Map()
  for (const type of findTypeDeclarations(source)) {
    for (const variant of type.variants) variants.set(variant.name, { ...variant, type })
  }

  return findMatchExpressions(source).flatMap(match => {
    const known = match.arms.map(arm => arm.variant).filter(variant => variant && variants.has(variant.name))
    if (!known.length) return []

    const arity = known
      .filter(variant => variant.arity !== variants.get(variant.name).fields.length)
      .map(variant => {
        const declared = variants.get(variant.name)
        return diagnostic(
          'E402',
          variant.line,
          `Pattern ${variant.name}(...) has ${variant.arity} fields, but variant ${variant.name} declares ${declared.fields.length} (${declared.fields.join(', ')})`,
          `Match ${variant.name} with exactly ${declared.fields.length} field pattern(s)`
        )
      })

    const types = new Set(known.map(variant => variants.get(variant.name).type))
    if (match.hasDefault || types.size !== 1) return arity

    const [type] = types
    const covered = new Set(known.map(variant => variant.name))
    const missing = type.variants
      .filter(variant => !covered.has(variant.name))
      .map(variant => diagnostic(
        'E401',
        match.line,
        `match on ${type.name} does not handle variant ${variant.name}`,
        `Add a "${variant.name}(...) => ..." arm or a final "_ => ..." arm`
      ))

    return [...missing, ...arity]
  })
}

function javascriptError(compiled) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jojo-check-'))
  const file = path.join(dir, 'program.mjs')

  try {
    fs.writeFileSync(file, compiled)
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    if (result.status === 0) return null
    const message = result.stderr.split('\n').find(line => /^\w*Error: /.test(line)) ?? result.stderr.trim()
    return diagnostic('E101', null, `Compiled JavaScript is invalid: ${message}`, 'Fix the JavaScript syntax near the reported construct and run jojo check again')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function compilerDiagnostics(source, reported) {
  let compiled
  try {
    compiled = compile(source)
  } catch (error) {
    if (error.message.startsWith('pure fn ') && reported.some(item => item.code === 'E201')) return []
    const line = error.message.match(/\(line (\d+)\)/)?.[1]
    return [diagnostic('E100', line ? Number(line) : null, error.message, 'Fix the reported syntax and run jojo check again')]
  }

  const invalid = javascriptError(compiled)
  return invalid ? [invalid] : []
}

function byLine(a, b) {
  return (a.line ?? Infinity) - (b.line ?? Infinity)
}

function result(diagnostics) {
  const errors = diagnostics.filter(item => item.severity === 'error').sort(byLine)
  const warnings = diagnostics.filter(item => item.severity === 'warning').sort(byLine)
  return { valid: errors.length === 0, errors, warnings }
}

export function checkSource(source) {
  const diagnostics = [
    ...analyze(() => missingHandlers(source)),
    ...analyze(() => purityErrors(source)),
    ...analyze(() => contractViolations(source)),
    ...analyze(() => matchErrors(source))
  ]

  return result([...diagnostics, ...compilerDiagnostics(source, diagnostics)])
}

export function checkPlan(plan) {
  try {
    planToJojo(plan)
    return result([])
  } catch (error) {
    if (error.name !== 'PlanValidationError') throw error
    return result([diagnostic('E700', null, error.message, 'Fix the plan field named in the message and run jojo check again')])
  }
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export function renderCheckText({ errors, warnings }) {
  if (!errors.length && !warnings.length) return 'valid: no problems found'

  const blocks = [...errors, ...warnings].map(item => [
    `${item.severity.toUpperCase()} ${item.code}`,
    ...(item.line === null ? [] : [`line ${item.line}`]),
    item.message,
    `suggestion: ${item.suggestion}`
  ].join('\n'))

  return [...blocks, `${plural(errors.length, 'error')}, ${plural(warnings.length, 'warning')}`].join('\n\n')
}
