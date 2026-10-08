import test from 'node:test'
import assert from 'node:assert/strict'

import { compile } from '../src/compiler.js'

test('pass stage keeps the current value unchanged', () => {
  const result = compile(`
    values
      |> pass
      |> map(value => value * 2)
      |> toArray
  `)

  assert.ok(!result.includes('|>'))
  assert.match(result, /toArray\(map\(values, value => value \* 2\)\)/)
  assert.doesNotMatch(result, /import \{[^}]*pass[^}]*\}/)
})

test('pass stage supports the placeholder argument', () => {
  const result = compile(`
    value
      |> pass(_)
      |> double
  `)

  assert.match(result, /double\(value\)/)
})
