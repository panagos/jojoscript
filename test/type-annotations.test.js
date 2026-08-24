import test from 'node:test'
import assert from 'node:assert/strict'
import { compile } from '../src/compiler.js'

/*
 * Type annotations are optional, never checked, and compiled into a JSDoc
 * block above the emitted function. Functions without annotations are
 * left completely untouched.
 */

test('block function with parameter and return types', () => {
  const result = compile('fn add(a: number, b: number): number { return a + b }')
  assert.match(result, /\/\*\*/)
  assert.match(result, /@param \{number\} a/)
  assert.match(result, /@param \{number\} b/)
  assert.match(result, /@returns \{number\}/)
  assert.match(result, /function add\(a, b\) \{ return a \+ b \}/)
  assert.ok(!result.includes(': number'))
})

test('expression function with types', () => {
  const result = compile('fn double(value: number): number = value * 2')
  assert.match(result, /@param \{number\} value/)
  assert.match(result, /@returns \{number\}/)
  assert.match(result, /function double\(value\) \{ return value \* 2; \}/)
})

test('async function with types', () => {
  const result = compile('async fn loadUser(id: number): Promise<User> { return await find(id) }')
  assert.match(result, /@param \{number\} id/)
  assert.match(result, /@returns \{Promise<User>\}/)
  assert.match(result, /async function loadUser\(id\) \{/)
})

test('parameter type with a default value', () => {
  const result = compile('fn greet(name: string = "World"): string = `Hello, ${name}!`')
  assert.match(result, /@param \{string\} name/)
  assert.match(result, /function greet\(name = "World"\)/)
})

test('only some parameters annotated', () => {
  const result = compile('fn add(a: number, b) { return a + b }')
  assert.match(result, /@param \{number\} a/)
  assert.ok(!result.includes('@param {number} b'))
  assert.match(result, /function add\(a, b\)/)
})

test('return type only, no parameter types', () => {
  const result = compile('fn getCount(): number { return 0 }')
  assert.match(result, /@returns \{number\}/)
  assert.ok(!result.includes('@param'))
  assert.match(result, /function getCount\(\)/)
})

test('functions without annotations are left untouched', () => {
  const source = 'fn add(a, b) { return a + b }'
  const result = compile(source)
  assert.ok(!result.includes('/**'))
  assert.match(result, /function add\(a, b\) \{ return a \+ b \}/)
})

test('destructured parameter with a type annotation', () => {
  const result = compile('fn greet({ name }: Person): string { return name }')
  assert.match(result, /@param \{Person\} \{ name \}/)
  assert.match(result, /function greet\(\{ name \}\)/)
})

test('exported typed function', () => {
  const result = compile('export fn add(a: number, b: number): number { return a + b }')
  assert.match(result, /export function add\(a, b\)/)
})

test('type annotations do not affect an unrelated function on the next line', () => {
  const result = compile('fn add(a: number): number { return a }\nfn plain(x) { return x }')
  assert.match(result, /function plain\(x\) \{ return x \}/)
  assert.equal((result.match(/\/\*\*/g) || []).length, 1)
})
