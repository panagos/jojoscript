/*
 * Canonical JSON for JojoScript values. Object keys are sorted so equal
 * values always produce identical text, and values plain JSON would lose
 * are encoded as `{ "$type": ... }` objects. An ordinary object that has its
 * own `$type` key is wrapped, so a tag is never ambiguous.
 */
export function toJson(value, options = {}) {
  return JSON.stringify(encode(value, new Set()), null, options.indent)
}

export function fromJson(text) {
  return decode(JSON.parse(text))
}

const ERROR_BUILT_INS = new Set(['name', 'message', 'stack', 'cause'])

function encodeNumber(value) {
  if (Number.isNaN(value) || !Number.isFinite(value) || Object.is(value, -0)) {
    return { $type: 'Number', value: Object.is(value, -0) ? '-0' : String(value) }
  }
  return value
}

function encodeObject(value, ancestors) {
  const result = {}
  for (const key of Object.keys(value).sort()) result[key] = encode(value[key], ancestors)
  return Object.hasOwn(value, '$type') ? { $type: 'Object', value: result } : result
}

function encodeError(error, ancestors) {
  const fields = {}
  for (const key of Object.keys(error).sort()) {
    if (!ERROR_BUILT_INS.has(key)) fields[key] = encode(error[key], ancestors)
  }

  const encoded = { $type: 'Error', name: error.name, message: error.message, fields }
  if ('cause' in error) encoded.cause = encode(error.cause, ancestors)
  return encoded
}

function encode(value, ancestors) {
  if (value === undefined) return { $type: 'undefined' }
  if (typeof value === 'number') return encodeNumber(value)
  if (typeof value === 'bigint') return { $type: 'BigInt', value: String(value) }
  if (typeof value === 'function') throw new TypeError('Cannot serialize a function')
  if (typeof value === 'symbol') throw new TypeError('Cannot serialize a symbol')
  if (value === null || typeof value !== 'object') return value

  if (ancestors.has(value)) throw new TypeError('Cannot serialize a circular structure')
  ancestors.add(value)

  try {
    if (value instanceof Date) return { $type: 'Date', value: value.toISOString() }
    if (value instanceof Map) {
      return { $type: 'Map', entries: [...value].map(([key, item]) => [encode(key, ancestors), encode(item, ancestors)]) }
    }
    if (value instanceof Set) return { $type: 'Set', values: [...value].map(item => encode(item, ancestors)) }
    if (value instanceof Error) return encodeError(value, ancestors)
    if (Array.isArray(value)) return value.map(item => encode(item, ancestors))
    if (typeof value.toJSON === 'function') return encode(value.toJSON(), ancestors)
    return encodeObject(value, ancestors)
  } finally {
    ancestors.delete(value)
  }
}

function decodeEntries(object) {
  const result = {}
  for (const [key, item] of Object.entries(object)) result[key] = decode(item)
  return result
}

function decodeError(encoded) {
  const error = new Error(encoded.message)
  error.name = encoded.name
  Object.assign(error, decodeEntries(encoded.fields ?? {}))
  if ('cause' in encoded) error.cause = decode(encoded.cause)
  return error
}

function decode(value) {
  if (Array.isArray(value)) return value.map(decode)
  if (value === null || typeof value !== 'object') return value
  if (!Object.hasOwn(value, '$type')) return decodeEntries(value)

  switch (value.$type) {
    case 'undefined': return undefined
    case 'Number': return Number(value.value)
    case 'BigInt': return BigInt(value.value)
    case 'Date': return new Date(value.value)
    case 'Map': return new Map(value.entries.map(([key, item]) => [decode(key), decode(item)]))
    case 'Set': return new Set(value.values.map(decode))
    case 'Error': return decodeError(value)
    case 'Object': return decodeEntries(value.value)
    default: throw new TypeError(`Unknown serialized type "${value.$type}"`)
  }
}
