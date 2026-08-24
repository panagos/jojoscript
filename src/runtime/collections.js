function iterable(value) {
  if (value == null) {
    throw new TypeError('Expected an iterable, got null or undefined')
  }

  if (typeof value[Symbol.iterator] === 'function') {
    return value
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

export function map(items, fn) {
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
