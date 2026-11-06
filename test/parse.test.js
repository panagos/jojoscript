import test from 'node:test'
import assert from 'node:assert/strict'

import { parseSource } from '../src/parse.js'
import { parseSource as exportedParseSource } from '../src/index.js'

const SOURCE = `import { toJson } from "@panagos/jojoscript/runtime"
import { helper } from "./helper"

effect fetchUser(id)

export type Result =
  | Ok(value)
  | Failed(message)

export pure fn normalize(user, { strict } = {}) {
  return user
}

async effectful fn save(user)
  requires user.id != null
{
  return user
}

fn double(value) = value * 2

pipeline activeUsers {
  source users
  |> filter(user => user.active)   @active
  |> map(normalize)
}

handle { fetchUser: id => ({ id }) } {
  label := match load() {
    Ok(value) => value
    _ => null
  }
}
`

test('parseSource reports the language, format version, and nodes ordered by line', () => {
  const parsed = parseSource(SOURCE)

  assert.equal(parsed.language, 'jojo')
  assert.equal(parsed.version, '1')
  assert.deepEqual(parsed.nodes.map(node => [node.kind, node.line]), [
    ['import', 1],
    ['import', 2],
    ['effect', 4],
    ['type', 6],
    ['function', 10],
    ['function', 14],
    ['function', 20],
    ['pipeline', 22],
    ['handle', 28],
    ['match', 29]
  ])
})

test('imports, effects, and types carry their declared details', () => {
  const [first, second, effect, type] = parseSource(SOURCE).nodes

  assert.deepEqual(first, { kind: 'import', line: 1, from: '@panagos/jojoscript/runtime', names: ['toJson'] })
  assert.deepEqual(second, { kind: 'import', line: 2, from: './helper', names: ['helper'] })
  assert.deepEqual(effect, { kind: 'effect', line: 4, name: 'fetchUser', params: ['id'] })
  assert.deepEqual(type, {
    kind: 'type',
    line: 6,
    name: 'Result',
    exported: true,
    variants: [{ name: 'Ok', fields: ['value'] }, { name: 'Failed', fields: ['message'] }]
  })
})

test('every fn declaration is a function node with modifiers, parameters, and contracts', () => {
  const functions = parseSource(SOURCE).nodes.filter(node => node.kind === 'function')

  assert.deepEqual(functions, [
    { kind: 'function', line: 10, name: 'normalize', params: ['user', '{ strict } = {}'], exported: true, async: false, purity: 'pure', body: 'block', requires: [], ensures: [] },
    { kind: 'function', line: 14, name: 'save', params: ['user'], exported: false, async: true, purity: 'effectful', body: 'block', requires: ['user.id != null'], ensures: [] },
    { kind: 'function', line: 20, name: 'double', params: ['value'], exported: false, async: false, purity: null, body: 'expression', requires: [], ensures: [] }
  ])
})

test('pipelines list their source, stages with ids, and whether they are declared blocks', () => {
  const pipeline = parseSource(SOURCE).nodes.find(node => node.kind === 'pipeline')

  assert.deepEqual(pipeline, {
    kind: 'pipeline',
    line: 22,
    name: 'activeUsers',
    declared: true,
    source: 'users',
    stages: [
      { type: 'filter', args: ['user => user.active'], id: 'active' },
      { type: 'map', args: ['normalize'], id: null }
    ]
  })

  const [inline] = parseSource('total := xs |> count\n').nodes
  assert.deepEqual(inline, { kind: 'pipeline', line: 1, name: 'total', declared: false, source: 'xs', stages: [{ type: 'count', args: [], id: null }] })
})

test('handle blocks list their handlers, and matches list their arm patterns', () => {
  const nodes = parseSource(SOURCE).nodes

  assert.deepEqual(nodes.find(node => node.kind === 'handle'), { kind: 'handle', line: 28, handlers: ['fetchUser'] })
  assert.deepEqual(nodes.find(node => node.kind === 'match'), { kind: 'match', line: 29, patterns: ['Ok(value)', '_'] })
})

test('parseSource rejects invalid syntax with the compiler error', () => {
  assert.throws(() => parseSource('type Result = ok(value)\n'), /Variant "ok" of type "Result" must start with an uppercase letter/)
})

test('parseSource is exported from the compiler entry point', () => {
  assert.equal(exportedParseSource, parseSource)
})

test('imports inside comments and strings are not nodes', () => {
  const nodes = parseSource('// import { a } from "./a"\nconst text = `\nimport { b } from "./b"\n`\n').nodes
  assert.deepEqual(nodes.filter(node => node.kind === 'import'), [])
})
