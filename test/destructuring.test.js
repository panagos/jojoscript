import test from 'node:test'
import assert from 'node:assert/strict'
import { compile } from '../src/compiler.js'

/*
 * Destructuring declarations:
 *   { a, b } := getUser()
 *   [head, ...rest] := items
 *   mutable { count } := state
 *
 * and tuple/multi-binding declarations:
 *   a, b := 1, 2
 *   mutable a, b := 1, 2
 */

test('object destructuring const declaration', () => {
  const result = compile('{ a, b } := getUser()')
  assert.equal(result.trim(), 'const { a, b } = getUser()')
})

test('array destructuring const declaration with rest', () => {
  const result = compile('[head, ...rest] := items')
  assert.equal(result.trim(), 'const [head, ...rest] = items')
})

test('object destructuring mutable declaration', () => {
  const result = compile('mutable { count } := state')
  assert.equal(result.trim(), 'let { count } = state')
})

test('array destructuring mutable declaration', () => {
  const result = compile('mutable [first, second] := pair')
  assert.equal(result.trim(), 'let [first, second] = pair')
})

test('nested destructuring pattern', () => {
  const result = compile('{ user: { id, name } } := response')
  assert.equal(result.trim(), 'const { user: { id, name } } = response')
})

test('export destructuring declaration', () => {
  const result = compile('export { a, b } := getUser()')
  assert.equal(result.trim(), 'export const { a, b } = getUser()')
})

test('destructuring pattern is not rewritten inside a string', () => {
  const source = 'const s = "{ a, b } := x"'
  assert.equal(compile(source).trim(), source)
})

test('destructuring pattern is not rewritten inside a comment', () => {
  const source = '// { a, b } := x\nconst y = 1'
  assert.equal(compile(source).trim(), source)
})

test('multi-binding tuple declaration', () => {
  const result = compile('a, b := 1, 2')
  assert.equal(result.trim(), 'const [a, b] = [1, 2]')
})

test('multi-binding mutable tuple declaration supports swapping', () => {
  const result = compile('mutable x, y := y, x')
  assert.equal(result.trim(), 'let [x, y] = [y, x]')
})

test('multi-binding declaration with three names', () => {
  const result = compile('a, b, c := 1, 2, 3')
  assert.equal(result.trim(), 'const [a, b, c] = [1, 2, 3]')
})

test('export multi-binding declaration', () => {
  const result = compile('export a, b := 1, 2')
  assert.equal(result.trim(), 'export const [a, b] = [1, 2]')
})

test('single-name declarations are unaffected by multi-binding transform', () => {
  const result = compile('value := 10')
  assert.equal(result.trim(), 'const value = 10')
})

test('ordinary JavaScript destructuring assignment (not declaration) is untouched', () => {
  const source = '({ a, b } = getUser())'
  assert.equal(compile(source).trim(), source)
})
