/*
 * Tagged union values are frozen plain objects (`{ tag: "Ok", value: 1 }`),
 * so they serialize to JSON and still match constructor patterns afterwards.
 */
export function defineType(typeName, variants) {
  const constructors = {}

  for (const [tag, fields] of Object.entries(variants)) {
    if (fields.includes('tag')) {
      throw new TypeError(`Variant "${tag}" cannot declare a field named "tag"`)
    }

    const construct = (...args) => {
      if (args.length !== fields.length) {
        const expected = fields.length === 1 ? '1 argument' : `${fields.length} arguments`
        const names = fields.length ? ` (${fields.join(', ')})` : ''
        throw new TypeError(`${tag} expects ${expected}${names}, got ${args.length}`)
      }

      const value = { tag }
      fields.forEach((field, index) => { value[field] = args[index] })
      return Object.freeze(value)
    }

    constructors[tag] = Object.assign(construct, { tag, type: typeName, fields: Object.freeze([...fields]) })
  }

  return Object.freeze(constructors)
}
