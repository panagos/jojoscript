import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { toJson, fromJson } from '../src/runtime/serialization.js'
import { toJson as exportedToJson, fromJson as exportedFromJson, FileCheckpointStore, ContractError, defineType } from '../src/runtime/index.js'

test('toJson sorts object keys so equal values always serialize identically', () => {
  assert.equal(toJson({ name: 'John', id: 42, active: true }), '{"active":true,"id":42,"name":"John"}')
  assert.equal(toJson({ b: { y: 1, x: 2 }, a: [3, { d: 4, c: 5 }] }), toJson({ a: [3, { c: 5, d: 4 }], b: { x: 2, y: 1 } }))
})

test('toJson can indent its output', () => {
  assert.equal(toJson({ b: 1, a: [true] }, { indent: 2 }), '{\n  "a": [\n    true\n  ],\n  "b": 1\n}')
})

test('values plain JSON would lose round-trip through tagged objects', () => {
  const value = {
    when: new Date('2026-01-02T03:04:05.000Z'),
    totals: new Map([['eu', 10n], ['us', 20n]]),
    tags: new Set(['a', 'b']),
    missing: undefined,
    special: [NaN, Infinity, -Infinity, -0],
    list: [undefined, null]
  }

  const restored = fromJson(toJson(value))

  assert.deepEqual(restored, value)
  assert.ok(restored.when instanceof Date)
  assert.ok(restored.totals instanceof Map)
  assert.ok(Object.is(restored.special[3], -0))
  assert.ok('missing' in restored)
  assert.match(toJson(new Date(0)), /^\{"\$type":"Date","value":"1970-01-01T00:00:00.000Z"\}$/)
})

test('errors keep their name, message, own fields, and cause', () => {
  const error = new ContractError('divide', 'requires', 'b != 0')
  error.cause = new TypeError('bad input')

  const restored = fromJson(toJson(error))

  assert.ok(restored instanceof Error)
  assert.equal(restored.name, 'ContractError')
  assert.equal(restored.message, 'Contract violated: divide requires b != 0')
  assert.equal(restored.kind, 'requires')
  assert.equal(restored.condition, 'b != 0')
  assert.equal(restored.cause.name, 'TypeError')
  assert.equal(restored.cause.message, 'bad input')
})

test('tagged union values and objects with toJSON serialize as plain data', () => {
  const Result = defineType('Result', { Ok: ['value'] })
  assert.equal(toJson(Result.Ok(1)), '{"tag":"Ok","value":1}')
  assert.equal(toJson({ toJSON: () => ({ kind: 'custom' }) }), '{"kind":"custom"}')
})

test('an ordinary object with a $type key is escaped instead of being mistaken for a tag', () => {
  const value = { $type: 'Date', value: 'not a date' }

  assert.deepEqual(fromJson(toJson(value)), value)
  assert.ok(!(fromJson(toJson(value)) instanceof Date))
})

test('functions, symbols, and circular structures cannot be serialized', () => {
  const circular = { name: 'loop' }
  circular.self = circular

  assert.throws(() => toJson({ run() {} }), { name: 'TypeError', message: 'Cannot serialize a function' })
  assert.throws(() => toJson(Symbol('x')), { name: 'TypeError', message: 'Cannot serialize a symbol' })
  assert.throws(() => toJson(circular), { name: 'TypeError', message: 'Cannot serialize a circular structure' })
})

test('fromJson rejects unknown tags', () => {
  assert.throws(() => fromJson('{"$type":"Mystery"}'), { name: 'TypeError', message: 'Unknown serialized type "Mystery"' })
})

test('the same object reached twice without a cycle serializes both times', () => {
  const shared = { id: 1 }
  assert.equal(toJson({ a: shared, b: shared }), '{"a":{"id":1},"b":{"id":1}}')
})

test('file checkpoints restore dates, maps, and sets exactly', async () => {
  const store = new FileCheckpointStore(fs.mkdtempSync(path.join(os.tmpdir(), 'jojo-serialization-')))
  const items = [{ at: new Date('2026-05-06T00:00:00.000Z'), seen: new Set([1]), counts: new Map([['a', 1]]) }]

  await store.save({ pipelineId: 'p', checkpointId: 'c', items, itemCount: 1 })
  const loaded = await store.load('p', 'c')

  assert.deepEqual(loaded.items, items)
  assert.ok(loaded.items[0].at instanceof Date)
})

test('file checkpoints written as plain JSON still load', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jojo-serialization-'))
  fs.mkdirSync(path.join(dir, 'p'))
  fs.writeFileSync(path.join(dir, 'p', 'c.json'), JSON.stringify({ pipelineId: 'p', checkpointId: 'c', items: [1, 2] }))

  assert.deepEqual((await new FileCheckpointStore(dir).load('p', 'c')).items, [1, 2])
})

test('toJson and fromJson are exported from the runtime', () => {
  assert.equal(exportedToJson, toJson)
  assert.equal(exportedFromJson, fromJson)
})
