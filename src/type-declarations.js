import { maskNonCode } from './lexer.js'

const VARIANT = String.raw`[A-Za-z_$][\w$]*(?:\s*\([^()]*\))?`
const TYPE_DECLARATION = new RegExp(
  String.raw`^([ \t]*)(export[ \t]+)?type[ \t]+([A-Za-z_$][\w$]*)[ \t]*=\s*(\|?\s*${VARIANT}(?:\s*\|\s*${VARIANT})*)`,
  'gm'
)

/*
 * `type Result = | Ok(value) | Failed(message)` declares a tagged union.
 * Variant names must start with an uppercase letter so `match` can tell a
 * constructor pattern such as `Ok(v)` apart from an ordinary call compared by value.
 */
export function findTypeDeclarations(source) {
  const mask = maskNonCode(source)
  const regex = new RegExp(TYPE_DECLARATION.source, TYPE_DECLARATION.flags)
  const declarations = []
  let match

  while ((match = regex.exec(source))) {
    if (mask.slice(match.index, match.index + match[0].length) !== match[0]) continue

    const [text, indent, exportPart, name, body] = match
    declarations.push({
      name,
      variants: parseVariants(name, body),
      indent,
      exported: Boolean(exportPart),
      start: match.index,
      end: match.index + text.length
    })
  }

  return declarations
}

function parseVariants(typeName, body) {
  const variants = body.split('|').map(part => part.trim()).filter(Boolean).map(part => {
    const [, name, params] = part.match(/^([A-Za-z_$][\w$]*)\s*(?:\(([^()]*)\))?$/)
    if (!/^[A-Z]/.test(name)) {
      throw new SyntaxError(`Variant "${name}" of type "${typeName}" must start with an uppercase letter`)
    }

    const fields = params?.trim() ? params.split(',').map(field => field.trim()) : []
    const duplicateField = fields.find((field, index) => fields.indexOf(field) !== index)
    if (duplicateField) {
      throw new SyntaxError(`Variant "${name}" declares field "${duplicateField}" more than once`)
    }

    return { name, fields }
  })

  const names = variants.map(variant => variant.name)
  const duplicate = names.find((name, index) => names.indexOf(name) !== index)
  if (duplicate) {
    throw new SyntaxError(`Type "${typeName}" declares variant "${duplicate}" more than once`)
  }

  return variants
}

export function transformTypeDeclarations(source) {
  let result = source

  for (const declaration of findTypeDeclarations(source).reverse()) {
    const exportPart = declaration.exported ? 'export ' : ''
    const variants = declaration.variants
      .map(variant => `${variant.name}: ${JSON.stringify(variant.fields).replaceAll(',', ', ')}`)
      .join(', ')
    const names = declaration.variants.map(variant => variant.name).join(', ')

    // Keeping the declaration's line count keeps later line numbers stable.
    const lineBreaks = '\n'.repeat(source.slice(declaration.start, declaration.end).split('\n').length - 1)

    const replacement =
      `${declaration.indent}${exportPart}const ${declaration.name} = defineType(${JSON.stringify(declaration.name)}, { ${variants} }); ` +
      `${exportPart}const { ${names} } = ${declaration.name}${lineBreaks}`

    result = result.slice(0, declaration.start) + replacement + result.slice(declaration.end)
  }

  return result
}
