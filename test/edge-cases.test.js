import test from 'node:test'
import assert from 'node:assert/strict'
import { compile } from '../src/compiler.js'

/*
 * These tests cover edge cases discovered while auditing the compiler:
 * pipelines used in call/array positions, pipelines as concise arrow
 * bodies, and jojo syntax (`:=`, `mutable`, `fn`) that must not be
 * rewritten when it merely appears inside a string, template literal or
 * comment.
 */

test('pipeline used as a function call argument', () => {
  const result = compile('console.log(users |> map(x => x.id) |> take(5))')
  assert.ok(!result.includes('|>'))
  assert.match(result, /console\.log\(take\(map\(users, x => x\.id\), 5\)\)/)
})

test('pipeline used as an array literal element', () => {
  const result = compile('const x = [users |> map(f) |> take(1)]')
  assert.ok(!result.includes('|>'))
  assert.match(result, /const x = \[take\(map\(users, f\), 1\)\]/)
})

test('pipeline used with multiple call arguments', () => {
  const result = compile('report(users |> map(f), options)')
  assert.ok(!result.includes('|>'))
  assert.match(result, /report\(map\(users, f\), options\)/)
})

test('pipeline as a concise arrow function body', () => {
  const result = compile('const f = x => x |> double')
  assert.ok(!result.includes('|>'))
  assert.match(result, /const f = x => double\(x\)/)
})

test('pipeline as a concise arrow function body with multiple params', () => {
  const result = compile('const f = (x, y) => x |> double')
  assert.ok(!result.includes('|>'))
  assert.match(result, /const f = \(x, y\) => double\(x\)/)
})

test('jojo const declaration is not rewritten inside a template literal', () => {
  const result = compile('sql := `\n  x := 5\n`\nconsole.log(sql)')
  assert.match(result, /const sql = `\n {2}x := 5\n`/)
})

test('mutable declaration is not rewritten inside a template literal', () => {
  const result = compile('msg := `\nmutable count := 0\n`')
  assert.match(result, /const msg = `\nmutable count := 0\n`/)
})

test('fn keyword is not rewritten inside a comment', () => {
  const source = '// fn helper() {}\nconst a = 1'
  assert.equal(compile(source).trim(), source)
})

test('fn-like text is not rewritten inside a string', () => {
  const source = 'const s = "fn test() {}"'
  assert.equal(compile(source).trim(), source)
})

test('expression fn with a trailing comment keeps the closing brace', () => {
  const result = compile('fn double(x) = x * 2 // doubles the value\nconsole.log(double(2))')
  assert.match(result, /function double\(x\) \{ return x \* 2; \} \/\/ doubles the value/)
  assert.match(result, /console\.log\(double\(2\)\)/)
})

test('expression fn supports a default parameter that calls a function', () => {
  const result = compile('fn greet(name = getName()) = name')
  assert.match(result, /function greet\(name = getName\(\)\) \{ return name; \}/)
})

test('dynamic import of a local module gets a .js extension', () => {
  const result = compile('const mod = await import("./util")')
  assert.match(result, /await import\("\.\/util\.js"\)/)
})

test('pipeline as an object literal property value', () => {
  const result = compile('const obj = { a: 1, items: users |> map(f) |> toArray }')
  assert.ok(!result.includes('|>'))
  assert.match(result, /items: toArray\(map\(users, f\)\)/)
})

test('pipeline as the false branch of a ternary', () => {
  const result = compile('const x = cond ? a : users |> map(f) |> toArray')
  assert.ok(!result.includes('|>'))
  assert.match(result, /cond \? a : toArray\(map\(users, f\)\)/)
})

test('local import is not rewritten inside a comment', () => {
  const source = '// import { x } from "./y"\nconst a = 1'
  assert.equal(compile(source).trim(), source)
})

test('export const declaration sugar', () => {
  const result = compile('export total := 0')
  assert.equal(result.trim(), 'export const total = 0')
})

test('export mutable declaration sugar', () => {
  const result = compile('export mutable counter := 0')
  assert.equal(result.trim(), 'export let counter = 0')
})
