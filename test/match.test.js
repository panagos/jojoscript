import test from 'node:test'
import assert from 'node:assert/strict'
import { compile } from '../src/compiler.js'

/*
 * `match` is a value-equality expression:
 *
 *   match status {
 *     "ok" => 1,
 *     "error" => 2,
 *     _ => 0
 *   }
 */

test('single-line match expression', () => {
  const result = compile('result := match status { "ok" => 1, "error" => 2, _ => 0 }')
  assert.match(result, /const __match = status;/)
  assert.match(result, /if \(__match === \("ok"\)\) return 1;/)
  assert.match(result, /if \(__match === \("error"\)\) return 2;/)
  assert.match(result, /return 0;/)
  assert.ok(result.includes('const result = (() => {'))
})

test('multiline match expression', () => {
  const result = compile(`
    result := match status {
      "ok" => 1,
      "error" => 2,
      _ => 0
    }
  `)
  assert.match(result, /if \(__match === \("ok"\)\) return 1;/)
  assert.match(result, /if \(__match === \("error"\)\) return 2;/)
})

test('match requires a default arm', () => {
  assert.throws(
    () => compile('result := match status { "ok" => 1 }'),
    /requires a default `_` arm/
  )
})

test('default arm must be last', () => {
  assert.throws(
    () => compile('result := match status { _ => 0, "ok" => 1 }'),
    /default `_` arm must be the last arm/
  )
})

test('match as a return statement', () => {
  const result = compile(`
    function classify(value) {
      return match value {
        0 => "zero",
        _ => "nonzero"
      }
    }
  `)
  assert.match(result, /return \(\(\) => \{/)
})

test('match arm expressions may contain pipelines', () => {
  const result = compile(`
    result := match status {
      "active" => users |> filter(isActive) |> toArray,
      _ => []
    }
  `)
  assert.ok(!result.includes('|>'))
  assert.match(result, /toArray\(filter\(users, isActive\)\)/)
})

test('nested match expressions', () => {
  const result = compile(`
    result := match outer {
      1 => match inner { "a" => "x", _ => "y" },
      _ => "z"
    }
  `)
  assert.equal((result.match(/const __match/g) || []).length, 2)
})

test('String.prototype.match calls are left untouched', () => {
  const source = 'const result = value.match(/x/)'
  assert.equal(compile(source).trim(), source)
})

test('a variable literally named match is left untouched', () => {
  const source = 'const match = 5\nconsole.log(match)'
  assert.equal(compile(source).trim(), source)
})

test('a for-of loop variable named match is left untouched', () => {
  const source = 'for (const match of matches) {\n  console.log(match)\n}'
  assert.equal(compile(source).trim(), source)
})

test('an object property named match is left untouched', () => {
  const source = 'const obj = { match: 1 }'
  assert.equal(compile(source).trim(), source)
})
