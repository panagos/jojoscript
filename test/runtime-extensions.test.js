import test from 'node:test'
import assert from 'node:assert/strict'

import {
  groupBy,
  partition,
  chunk,
  window,
  zip,
  zipWith,
  scan,
  sortBy,
  distinctBy,
  tap,
  mapAsync,
  filterAsync,
  toArrayAsync,
  toArray,
  take
} from '../src/runtime/collections.js'

test('groupBy groups items by a key function', () => {
  const groups = groupBy(
    [{ userId: 1, id: 'a' }, { userId: 2, id: 'b' }, { userId: 1, id: 'c' }],
    item => item.userId
  )

  assert.ok(groups instanceof Map)
  assert.deepEqual(groups.get(1).map(item => item.id), ['a', 'c'])
  assert.deepEqual(groups.get(2).map(item => item.id), ['b'])
})

test('partition splits into matching and non-matching arrays', () => {
  const [evens, odds] = partition([1, 2, 3, 4, 5], value => value % 2 === 0)
  assert.deepEqual(evens, [2, 4])
  assert.deepEqual(odds, [1, 3, 5])
})

test('chunk groups items into fixed-size arrays', () => {
  assert.deepEqual(toArray(chunk([1, 2, 3, 4, 5], 2)), [[1, 2], [3, 4], [5]])
})

test('chunk requires a positive integer size', () => {
  assert.throws(() => toArray(chunk([1, 2, 3], 0)), /positive integer/)
})

test('window yields a sliding view over the input', () => {
  assert.deepEqual(toArray(window([1, 2, 3, 4], 2)), [[1, 2], [2, 3], [3, 4]])
})

test('zip pairs elements from two iterables and stops at the shorter one', () => {
  assert.deepEqual(toArray(zip([1, 2, 3], ['a', 'b'])), [[1, 'a'], [2, 'b']])
})

test('zipWith combines elements from two iterables with an arity-2 function', () => {
  assert.deepEqual(
    toArray(zipWith([1, 2, 3], [10, 20], (a, b) => a + b)),
    [11, 22]
  )
})

test('zipWith never materializes either infinite/lazy source', () => {
  function* naturals() {
    let n = 0
    while (true) yield n++
  }

  function* letters() {
    const alphabet = 'abcdefghij'
    let i = 0
    while (true) yield alphabet[i++ % alphabet.length]
  }

  const result = zipWith(naturals(), letters(), (n, letter) => `${letter}${n}`)
  assert.deepEqual(toArray(take(result, 3)), ['a0', 'b1', 'c2'])
})

test('scan yields a running accumulation', () => {
  assert.deepEqual(toArray(scan([1, 2, 3, 4], (sum, value) => sum + value, 0)), [1, 3, 6, 10])
})

test('sortBy sorts by a derived key', () => {
  const people = [{ name: 'Bea' }, { name: 'Amy' }, { name: 'Cid' }]
  assert.deepEqual(sortBy(people, person => person.name).map(p => p.name), ['Amy', 'Bea', 'Cid'])
})

test('distinctBy removes duplicates by a derived key', () => {
  const posts = [{ id: 1, tag: 'a' }, { id: 2, tag: 'a' }, { id: 3, tag: 'b' }]
  assert.deepEqual(toArray(distinctBy(posts, post => post.tag)).map(p => p.id), [1, 3])
})

test('tap observes each item without changing the pipeline', () => {
  const seen = []
  const result = toArray(tap([1, 2, 3], value => seen.push(value)))
  assert.deepEqual(result, [1, 2, 3])
  assert.deepEqual(seen, [1, 2, 3])
})

test('tap is lazy', () => {
  let calls = 0
  const result = tap([1, 2, 3], () => calls++)
  assert.equal(calls, 0)
  toArray(result)
  assert.equal(calls, 3)
})

test('mapAsync awaits each transform', async () => {
  const result = await toArrayAsync(
    mapAsync([1, 2, 3], async value => value * 2)
  )
  assert.deepEqual(result, [2, 4, 6])
})

test('filterAsync awaits each predicate', async () => {
  const result = await toArrayAsync(
    filterAsync([1, 2, 3, 4], async value => value % 2 === 0)
  )
  assert.deepEqual(result, [2, 4])
})

test('mapAsync and filterAsync can be chained', async () => {
  const result = await toArrayAsync(
    filterAsync(
      mapAsync([1, 2, 3, 4], async value => value * 10),
      async value => value > 15
    )
  )
  assert.deepEqual(result, [20, 30, 40])
})

test('toArrayAsync works over a plain sync iterable', async () => {
  assert.deepEqual(await toArrayAsync([1, 2, 3]), [1, 2, 3])
})
