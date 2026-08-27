function iterable(value) {
  if (value == null) {
    throw new TypeError('Expected an iterable, got null or undefined')
  }

  if (typeof value[Symbol.iterator] === 'function') {
    return value
  }

  /*
   * An async generator/iterable (e.g. from `mapAsync`, `checkpoint`,
   * `inspect`, or `traceNode` wrapping one of those) has `.next` too, but
   * calling it synchronously here would silently loop forever comparing a
   * Promise's `.done` (always `undefined`) instead of a real boolean. Fail
   * fast with a clear message instead of hanging.
   */
  if (typeof value[Symbol.asyncIterator] === 'function') {
    throw new TypeError(
      'Expected a sync iterable but got an async iterable/generator ' +
      '(e.g. produced by mapAsync, filterAsync, checkpoint, inspect, or ' +
      'retry on an async function). Use the async equivalent instead ' +
      '(e.g. toArrayAsync, or `for await`).'
    )
  }

  if (typeof value.next === 'function') {
    return {
      [Symbol.iterator]() {
        return value
      }
    }
  }

  throw new TypeError('Expected an iterable or iterator')
}

/*
 * Like `iterable`, but accepts (and prefers) an async iterable/iterator so
 * `for await` correctly awaits values produced by async generators such as
 * `mapAsync`/`filterAsync`, in addition to ordinary sync iterables.
 */
function asyncIterable(value) {
  if (value == null) {
    throw new TypeError('Expected an iterable, got null or undefined')
  }

  if (
    typeof value[Symbol.asyncIterator] === 'function' ||
    typeof value[Symbol.iterator] === 'function'
  ) {
    return value
  }

  if (typeof value.next === 'function') {
    return {
      [Symbol.asyncIterator]() {
        return value
      }
    }
  }

  throw new TypeError('Expected an iterable or iterator')
}

const PARALLEL_TAG = Symbol('jojo.parallel')

/*
 * Marks an iterable as wanting bounded-concurrency processing by the very
 * next `map()` stage: `users |> parallel(8) |> map(fetchProfile)`. This
 * does not itself run anything concurrently — it just tags the upstream
 * iterable so `map()` knows to switch from sequential to a bounded worker
 * pool. Any stage other than `map` receiving this tag is a usage error
 * (the tag object has no iterator of its own).
 */
export function parallel(items, concurrency, meta) {
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new RangeError('parallel concurrency must be a positive integer')
  }
  return { [PARALLEL_TAG]: concurrency, source: items, meta }
}

function isParallelTagged(value) {
  return value != null && typeof value === 'object' && PARALLEL_TAG in value
}

function getIterator(items) {
  if (items == null) {
    throw new TypeError('Expected an iterable, got null or undefined')
  }
  if (typeof items[Symbol.asyncIterator] === 'function') return items[Symbol.asyncIterator]()
  if (typeof items[Symbol.iterator] === 'function') return items[Symbol.iterator]()
  if (typeof items.next === 'function') return items
  throw new TypeError('Expected an iterable or iterator')
}

/*
 * Bounded-concurrency mapping: at most `concurrency` calls to `fn` are ever
 * in flight at once (no unbounded `Promise.all`), memory usage stays
 * bounded by `concurrency`, and results are yielded in the original order
 * as soon as the item at the head of the window resolves — later items in
 * the window keep running concurrently in the background while the head
 * is awaited.
 *
 * `pullNext()` returns the in-flight promise wrapped in a plain object
 * (`{ promise }`) rather than the promise itself: since `pullNext` is an
 * `async function`, directly returning/awaiting the bare `fn(...)` promise
 * would make JS "flatten" it — `await pullNext()` would then already be
 * the *resolved value* of `fn`, silently serializing every call (no two
 * calls ever truly overlap) and, since a resolved value of `0`/`''`/etc.
 * is falsy, incorrectly being treated as "no more items".
 */
async function* mapConcurrent(items, fn, concurrency) {
  const iterator = getIterator(items)
  const window = []
  let index = 0
  let exhausted = false

  async function pullNext() {
    if (exhausted) return undefined
    const step = await iterator.next()
    if (step.done) {
      exhausted = true
      return undefined
    }
    const i = index++
    return { promise: Promise.resolve(fn(step.value, i)) }
  }

  for (let i = 0; i < concurrency && !exhausted; i++) {
    const started = await pullNext()
    if (started) window.push(started)
  }

  while (window.length) {
    const head = window.shift()
    yield await head.promise
    if (!exhausted) {
      const started = await pullNext()
      if (started) window.push(started)
    }
  }
}

export function map(items, fn) {
  if (isParallelTagged(items)) {
    return mapConcurrent(items.source, fn, items[PARALLEL_TAG])
  }
  return (function* () {
    let index = 0
    for (const item of iterable(items)) {
      yield fn(item, index++)
    }
  })()
}

export function filter(items, fn) {
  return (function* () {
    let index = 0
    for (const item of iterable(items)) {
      if (fn(item, index++)) yield item
    }
  })()
}

export function take(items, count) {
  return (function* () {
    if (count <= 0) return

    let emitted = 0
    for (const item of iterable(items)) {
      yield item
      emitted++
      if (emitted >= count) return
    }
  })()
}

export function skip(items, count) {
  return (function* () {
    let index = 0
    for (const item of iterable(items)) {
      if (index++ < count) continue
      yield item
    }
  })()
}

export function unique(items) {
  return (function* () {
    const seen = new Set()
    for (const item of iterable(items)) {
      if (seen.has(item)) continue
      seen.add(item)
      yield item
    }
  })()
}

export function flatMap(items, fn) {
  return (function* () {
    let index = 0
    for (const item of iterable(items)) {
      for (const value of iterable(fn(item, index++))) {
        yield value
      }
    }
  })()
}

export function reduce(items, fn, initial) {
  const iterator = iterable(items)[Symbol.iterator]()
  let accumulator

  if (arguments.length >= 3) {
    accumulator = initial
  } else {
    const first = iterator.next()
    if (first.done) {
      throw new TypeError('Reduce of empty iterable with no initial value')
    }
    accumulator = first.value
  }

  let index = arguments.length >= 3 ? 0 : 1
  for (let step = iterator.next(); !step.done; step = iterator.next()) {
    accumulator = fn(accumulator, step.value, index++)
  }

  return accumulator
}

export function toArray(items) {
  return Array.from(iterable(items))
}

export function count(items) {
  let result = 0
  for (const _ of iterable(items)) result++
  return result
}

export function first(items) {
  for (const item of iterable(items)) return item
  return undefined
}

export function find(items, predicate) {
  let index = 0
  for (const item of iterable(items)) {
    if (predicate(item, index++)) return item
  }
  return undefined
}

export function some(items, predicate) {
  let index = 0
  for (const item of iterable(items)) {
    if (predicate(item, index++)) return true
  }
  return false
}

export function every(items, predicate) {
  let index = 0
  for (const item of iterable(items)) {
    if (!predicate(item, index++)) return false
  }
  return true
}

export function sort(items, fn) {
  return Array.from(iterable(items)).sort(fn)
}

export function sortBy(items, keyFn) {
  return Array.from(iterable(items)).sort((a, b) => {
    const keyA = keyFn(a)
    const keyB = keyFn(b)
    if (keyA < keyB) return -1
    if (keyA > keyB) return 1
    return 0
  })
}

export function distinctBy(items, keyFn) {
  return (function* () {
    const seen = new Set()
    for (const item of iterable(items)) {
      const key = keyFn(item)
      if (seen.has(key)) continue
      seen.add(key)
      yield item
    }
  })()
}

export function tap(items, fn) {
  return (function* () {
    let index = 0
    for (const item of iterable(items)) {
      fn(item, index++)
      yield item
    }
  })()
}

export function chunk(items, size) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError('chunk size must be a positive integer')
  }

  return (function* () {
    let buffer = []
    for (const item of iterable(items)) {
      buffer.push(item)
      if (buffer.length === size) {
        yield buffer
        buffer = []
      }
    }
    if (buffer.length) yield buffer
  })()
}

/*
 * Groups a lazy/streaming source into fixed-size arrays, remaining lazy —
 * items are never buffered beyond the current, not-yet-full batch, which
 * is exactly the bounded buffering §13 (backpressure) requires. Equivalent
 * to `chunk`, exposed under the pipeline's own vocabulary.
 */
export function batch(items, size, meta) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError('batch size must be a positive integer')
  }
  return chunk(items, size)
}

export function window(items, size) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError('window size must be a positive integer')
  }

  return (function* () {
    let buffer = []
    for (const item of iterable(items)) {
      buffer.push(item)
      if (buffer.length > size) buffer.shift()
      if (buffer.length === size) yield buffer.slice()
    }
  })()
}

export function zip(items, other) {
  return (function* () {
    const left = iterable(items)[Symbol.iterator]()
    const right = iterable(other)[Symbol.iterator]()

    while (true) {
      const a = left.next()
      const b = right.next()
      if (a.done || b.done) return
      yield [a.value, b.value]
    }
  })()
}

export function zipWith(items, other, fn) {
  return (function* () {
    const left = iterable(items)[Symbol.iterator]()
    const right = iterable(other)[Symbol.iterator]()

    while (true) {
      const a = left.next()
      const b = right.next()
      if (a.done || b.done) return
      yield fn(a.value, b.value)
    }
  })()
}

export function scan(items, fn, initial) {
  return (function* () {
    let accumulator = initial
    let index = 0
    for (const item of iterable(items)) {
      accumulator = fn(accumulator, item, index++)
      yield accumulator
    }
  })()
}

export function partition(items, predicate) {
  const truthy = []
  const falsy = []
  let index = 0

  for (const item of iterable(items)) {
    if (predicate(item, index++)) {
      truthy.push(item)
    } else {
      falsy.push(item)
    }
  }

  return [truthy, falsy]
}

export function groupBy(items, keyFn) {
  const groups = new Map()

  for (const item of iterable(items)) {
    const key = keyFn(item)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }

  return groups
}

export async function* mapAsync(items, fn) {
  let index = 0
  for await (const item of asyncIterable(items)) {
    yield await fn(item, index++)
  }
}

export async function* filterAsync(items, fn) {
  let index = 0
  for await (const item of asyncIterable(items)) {
    if (await fn(item, index++)) yield item
  }
}

export async function toArrayAsync(items) {
  const result = []
  for await (const item of asyncIterable(items)) result.push(item)
  return result
}
