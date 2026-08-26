import test from 'node:test'
import assert from 'node:assert/strict'

import {
  map,
  filter,
  take,
  skip,
  unique,
  flatMap,
  reduce,
  toArray,
  count,
  first,
  find,
  some,
  every,
  sort
} from '../src/runtime/collections.js'

import { compile } from '../src/compiler.js'

test('map is lazy', () => {
  let calls = 0
  const result = map([1, 2, 3], value => {
    calls++
    return value * 2
  })

  assert.equal(calls, 0)
  assert.deepEqual([...take(result, 1)], [2])
  assert.equal(calls, 1)
})

test('filter + map + take does not allocate intermediate arrays', () => {
  let mapped = 0
  const result = take(
    map(
      filter([1, 2, 3, 4, 5], value => value % 2 === 1),
      value => {
        mapped++
        return value * 10
      }
    ),
    2
  )

  assert.equal(mapped, 0)
  assert.deepEqual(toArray(result), [10, 30])
  assert.equal(mapped, 2)
})

test('reduce is a terminal operation', () => {
  const result = reduce(
    map([1, 2, 3], value => value * 2),
    (sum, value) => sum + value,
    0
  )

  assert.equal(result, 12)
})

test('reduce supports an initial-less iterable', () => {
  assert.equal(reduce([1, 2, 3], (sum, value) => sum + value), 6)
  assert.throws(() => reduce([], (sum, value) => sum + value), /empty iterable/i)
})

test('unique is lazy', () => {
  assert.deepEqual(toArray(take(unique([1, 1, 2, 2, 3]), 2)), [1, 2])
})

test('skip is lazy', () => {
  assert.deepEqual(toArray(skip([1, 2, 3, 4], 2)), [3, 4])
})

test('flatMap is lazy', () => {
  assert.deepEqual(
    toArray(flatMap([1, 2, 3], value => [value, value * 10])),
    [1, 10, 2, 20, 3, 30]
  )
})

test('terminal operations consume only what they need', () => {
  let calls = 0
  const values = map([1, 2, 3, 4], value => {
    calls++
    return value
  })

  assert.equal(first(values), 1)
  assert.equal(calls, 1)

  const values2 = map([1, 2, 3, 4], value => {
    calls++
    return value
  })
  assert.equal(find(values2, value => value === 3), 3)
  assert.equal(calls, 4)
})

test('sort is an explicit materialization boundary', () => {
  const result = sort(map([3, 1, 2], value => value), (a, b) => a - b)
  assert.ok(Array.isArray(result))
  assert.deepEqual(result, [1, 2, 3])
})

test('compiler imports iterator stdlib stages', () => {
  const result = compile(`
    values
      |> filter(value => value > 0)
      |> map(value => value * 2)
      |> take(10)
      |> reduce((sum, value) => sum + value, 0)
  `)

  assert.ok(!result.includes('|>'))
  assert.match(result, /import \{[^}]*filter[^}]*map[^}]*take[^}]*reduce[^}]*\} from "@panagos\/jojoscript\/runtime"/s)
})

test('compiler supports toArray terminal', () => {
  const result = compile('values |> map(value => value * 2) |> toArray')
  assert.match(result, /toArray\(map\(values, value => value \* 2\)\)/)
})

test('ordinary JavaScript arrays remain arrays', () => {
  const result = compile('const values = [1, 2, 3].map(value => value * 2)')
  assert.equal(result.trim(), 'const values = [1, 2, 3].map(value => value * 2)')
})

test('some and every short-circuit', () => {
  let calls = 0
  assert.equal(some([1, 2, 3], value => {
    calls++
    return value === 2
  }), true)
  assert.equal(calls, 2)

  calls = 0
  assert.equal(every([2, 4, 6], value => {
    calls++
    return value % 2 === 0
  }), true)
  assert.equal(calls, 3)
})
