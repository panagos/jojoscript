import test from 'node:test'
import assert from 'node:assert/strict'

import { compile } from '../src/compiler.js'
import {
  transformEffectDeclarations,
  transformHandleBlocks,
  findEffectDeclarations,
  findHandleBlocks
} from '../src/effect-parser.js'

test('effect declaration compiles to a defineEffect() call', () => {
  const output = transformEffectDeclarations('effect fetchUser(id)\n')
  assert.equal(output.trim(), 'const fetchUser = defineEffect("fetchUser", ["id"])')
})

test('effect declaration supports multiple params and no params', () => {
  assert.equal(
    transformEffectDeclarations('effect saveUser(user, options)\n').trim(),
    'const saveUser = defineEffect("saveUser", ["user","options"])'
  )
  assert.equal(
    transformEffectDeclarations('effect tick()\n').trim(),
    'const tick = defineEffect("tick", [])'
  )
})

test('export effect keeps the export keyword', () => {
  assert.equal(
    transformEffectDeclarations('export effect fetchUser(id)\n').trim(),
    'export const fetchUser = defineEffect("fetchUser", ["id"])'
  )
})

test('findEffectDeclarations finds every declared effect and its params', () => {
  const declarations = findEffectDeclarations('effect fetchUser(id)\neffect saveUser(user)\n')
  assert.deepEqual(declarations.map(d => d.name), ['fetchUser', 'saveUser'])
  assert.deepEqual(declarations[0].params, ['id'])
  assert.deepEqual(declarations[1].params, ['user'])
})

test('a string that merely contains the word "effect" is left untouched', () => {
  const source = 'const message = "effect fetchUser(id) is not real code"\n'
  assert.equal(transformEffectDeclarations(source), source)
  assert.deepEqual(findEffectDeclarations(source), [])
})

test('handle block compiles to an awaited withHandlers() call', () => {
  const source = `handle {
  fetchUser: id => fakeUser(id)
} {
  console.log(fetchUser(1))
}`

  const output = transformHandleBlocks(source)
  assert.match(output, /^\(await withHandlers\(\{/)
  assert.match(output, /fetchUser: id => fakeUser\(id\)/)
  assert.match(output, /async \(\) => \{/)
  assert.match(output, /console\.log\(fetchUser\(1\)\)/)
})

test('handle requires a body block', () => {
  assert.throws(
    () => transformHandleBlocks('handle { fetchUser: fake } x\n'),
    /must be followed by a body block/
  )
})

test('a variable or method named handle is left alone', () => {
  const source = 'const handle = 1\nstream.handle(chunk)\n'
  assert.equal(transformHandleBlocks(source), source)
  assert.deepEqual(findHandleBlocks(source), [])
})

test('findHandleBlocks extracts handler names', () => {
  const source = `handle {
  fetchUser: fakeFetchUser,
  saveUser: fakeSaveUser
} {
  body()
}`
  const blocks = findHandleBlocks(source)
  assert.equal(blocks.length, 1)
  assert.deepEqual(blocks[0].handlerNames, ['fetchUser', 'saveUser'])
})

test('nested handle blocks compile inside-out', () => {
  const source = `handle {
  fetchUser: outerFake
} {
  handle {
    fetchUser: innerFake
  } {
    body()
  }
}`
  const output = transformHandleBlocks(source)
  // The inner withHandlers call must be fully formed *inside* the outer one.
  assert.match(output, /withHandlers\(\{\s*fetchUser: outerFake\s*\}, async \(\) => \{[\s\S]*withHandlers\(\{\s*fetchUser: innerFake\s*\}/)
})

test('compile() auto-imports defineEffect only when effect declarations are used', () => {
  const output = compile('effect fetchUser(id)\nconsole.log(fetchUser)\n')
  assert.match(output, /import \{ defineEffect \} from "@panagos\/jojoscript\/runtime"/)
})

test('compile() auto-imports withHandlers only when handle blocks are used', () => {
  const output = compile(`
handle {
  fetchUser: id => id
} {
  console.log(1)
}
`)
  assert.match(output, /import \{ withHandlers \} from "@panagos\/jojoscript\/runtime"/)
})

test('compile() merges defineEffect and withHandlers into one runtime import alongside pipeline stages', () => {
  const output = compile(`
effect fetchUser(id)

result :=
  handle {
    fetchUser: id => id * 2
  } {
    [1, 2, 3] |> map(fetchUser) |> toArrayAsync |> await
  }
`)
  const importLine = output.split('\n').find(line => line.includes('@panagos/jojoscript/runtime'))
  assert.ok(importLine, 'expected a runtime import line')
  assert.match(importLine, /defineEffect/)
  assert.match(importLine, /withHandlers/)
  assert.match(importLine, /\bmap\b/)
  assert.match(importLine, /toArrayAsync/)
})

test('a file with neither effects nor handle blocks gets no effect-related import', () => {
  const output = compile('x := [1, 2, 3] |> map(n => n * 2) |> toArray\n')
  assert.doesNotMatch(output, /defineEffect|withHandlers/)
})

test('existing programs without effect syntax are unaffected by the new transforms', () => {
  const source = 'users := getUsers()\nconsole.log(users)\n'
  const output = compile(source)
  assert.match(output, /^const users = getUsers\(\)/)
  assert.doesNotMatch(output, /defineEffect|withHandlers/)
})
