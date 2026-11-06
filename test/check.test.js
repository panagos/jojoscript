import test from 'node:test'
import assert from 'node:assert/strict'

import { checkSource, checkPlan, renderCheckText } from '../src/check.js'
import { checkSource as exportedCheckSource } from '../src/index.js'
import { findMatchExpressions } from '../src/match-parser.js'

const codes = diagnostics => diagnostics.map(({ code, line }) => [code, line])

test('a clean program is valid with no diagnostics', () => {
  assert.deepEqual(checkSource('total := [1, 2] |> reduce((sum, value) => sum + value, 0)\n'), {
    valid: true,
    errors: [],
    warnings: []
  })
})

test('W102 warns about effects that are used without a handler in the file', () => {
  const result = checkSource([
    'effect fetchUser(id)',
    'effect saveUser(user)',
    '',
    'handle { saveUser: user => user } {',
    '  users |> map(fetchUser) |> map(saveUser)',
    '}',
    ''
  ].join('\n'))

  assert.equal(result.valid, true)
  assert.deepEqual(result.warnings, [{
    code: 'W102',
    severity: 'warning',
    line: 5,
    message: 'Effect "fetchUser" has no handler in this file',
    suggestion: 'Add a handler for "fetchUser" in a handle { ... } block, or make sure every caller installs one'
  }])
})

test('E201 reports every purity violation', () => {
  const result = checkSource([
    'effect saveUser(user)',
    'effectful fn audit(user) { return user }',
    '',
    'pure fn normalize(user) {',
    '  audit(user)',
    '  return saveUser(user)',
    '}',
    ''
  ].join('\n'))

  assert.equal(result.valid, false)
  assert.deepEqual(codes(result.errors), [['E201', 5], ['E201', 6]])
  assert.equal(result.errors[1].message, 'pure fn "normalize" uses effect "saveUser"')
  assert.equal(result.errors[1].suggestion, 'Remove the use of "saveUser" from "normalize", or declare "normalize" as effectful fn')
})

test('E301 reports calls whose literal arguments break a requires clause', () => {
  const result = checkSource([
    'fn divide(a, b)',
    '  requires b != 0',
    '{',
    '  return a / b',
    '}',
    '',
    'ok := divide(4, 2)',
    'bad := divide(1, 0)',
    'unknown := divide(x, y)',
    ''
  ].join('\n'))

  assert.deepEqual(codes(result.errors), [['E301', 8]])
  assert.equal(result.errors[0].message, 'Call divide(1, 0) violates "requires b != 0"')
  assert.equal(result.errors[0].suggestion, 'Pass arguments to "divide" that satisfy b != 0')
})

test('contracts that read properties or call functions are never evaluated statically', () => {
  const result = checkSource([
    'fn save(user)',
    '  requires user.id != null',
    '  requires isValid(user)',
    '{',
    '  return user',
    '}',
    '',
    'save(null)',
    ''
  ].join('\n'))

  assert.deepEqual(result.errors, [])
})

test('E401 and E402 report non-exhaustive matches and wrong constructor arity', () => {
  const result = checkSource([
    'type Result = Ok(value) | Failed(message) | Pending',
    '',
    'fn describe(result) {',
    '  return match result {',
    '    Ok(value, extra) => value',
    '    Failed(message) => message',
    '  }',
    '}',
    '',
    'fn safe(result) {',
    '  return match result {',
    '    Ok(value) => value',
    '    _ => null',
    '  }',
    '}',
    ''
  ].join('\n'))

  assert.deepEqual(codes(result.errors), [['E401', 4], ['E402', 5]])
  assert.equal(result.errors[0].message, 'match on Result does not handle variant Pending')
  assert.equal(result.errors[0].suggestion, 'Add a "Pending(...) => ..." arm or a final "_ => ..." arm')
  assert.equal(result.errors[1].message, 'Pattern Ok(...) has 2 fields, but variant Ok declares 1 (value)')
})

test('E100 reports compiler errors, and E101 reports compiled JavaScript that does not parse', () => {
  const syntax = checkSource('x := match y { "a" => 1 }\n')
  assert.deepEqual(syntax.errors.map(error => [error.code, error.message]), [['E100', 'match requires a default `_` arm']])

  const javascript = checkSource('fn broken( {\n  return 1\n}\n')
  assert.equal(javascript.errors[0].code, 'E101')
  assert.match(javascript.errors[0].message, /^Compiled JavaScript is invalid: /)
})

test('a purity violation is reported once, not again as a compiler error', () => {
  const result = checkSource('effect save(x)\npure fn f(x) { return save(x) }\n')
  assert.deepEqual(result.errors.map(error => error.code), ['E201'])
})

test('checkPlan reports invalid plans as E700 with the plan path', () => {
  assert.deepEqual(checkPlan({ version: 1, pipelines: [] }), { valid: true, errors: [], warnings: [] })
  assert.deepEqual(checkPlan({ version: 1, pipelines: [{ pipeline: 'p', stages: [] }] }).errors, [{
    code: 'E700',
    severity: 'error',
    line: null,
    message: 'Invalid plan: pipelines[0].stages must be a non-empty array',
    suggestion: 'Fix the plan field named in the message and run jojo check again'
  }])
})

test('findMatchExpressions reports arms with constructor arity', () => {
  const [match] = findMatchExpressions('x := match r {\n  Ok(a) => a\n  { b } => b\n  _ => 0\n}\n')
  assert.equal(match.line, 1)
  assert.equal(match.hasDefault, true)
  assert.deepEqual(match.arms.map(arm => arm.variant), [{ name: 'Ok', arity: 1, line: 2 }, null, null])
})

test('checkSource is exported from the compiler entry point', () => {
  assert.equal(exportedCheckSource, checkSource)
})

test('renderCheckText prints each diagnostic with its code, line, message, and suggestion', () => {
  const text = renderCheckText({
    valid: false,
    errors: [{ code: 'E301', severity: 'error', line: 8, message: 'Call divide(1, 0) violates "requires b != 0"', suggestion: 'Pass arguments to "divide" that satisfy b != 0' }],
    warnings: [{ code: 'E700', severity: 'warning', line: null, message: 'Plan warning', suggestion: 'Fix it' }]
  })

  assert.equal(text, [
    'ERROR E301',
    'line 8',
    'Call divide(1, 0) violates "requires b != 0"',
    'suggestion: Pass arguments to "divide" that satisfy b != 0',
    '',
    'WARNING E700',
    'Plan warning',
    'suggestion: Fix it',
    '',
    '1 error, 1 warning'
  ].join('\n'))
  assert.equal(renderCheckText({ valid: true, errors: [], warnings: [] }), 'valid: no problems found')
})
