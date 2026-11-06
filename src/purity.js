import { maskNonCode } from './lexer.js'
import { findEffectDeclarations } from './effect-parser.js'

const PURITY_DECLARATION = /^([ \t]*)(export[ \t]+)?(async[ \t]+)?(pure|effectful)[ \t]+(async[ \t]+)?fn[ \t]+([A-Za-z_$][\w$]*)/gm

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length
}

function matchingBrace(code, openIndex) {
  let depth = 0
  for (let i = openIndex; i < code.length; i++) {
    if (code[i] === '{' || code[i] === '(') depth++
    else if ((code[i] === '}' || code[i] === ')') && --depth === 0) return i
  }
  return code.length
}

/*
 * Body bounds come from the masked source so braces inside strings and
 * comments never end a body early.
 */
function bodyRange(code, nameEnd) {
  const paramsOpen = code.indexOf('(', nameEnd)
  const paramsClose = matchingBrace(code, paramsOpen)
  const rest = code.slice(paramsClose + 1)
  const head = rest.search(/[{=]/)
  const start = paramsClose + 1 + head

  if (code[start] === '=') {
    const lineEnd = code.indexOf('\n', start)
    return { start, end: lineEnd === -1 ? code.length : lineEnd }
  }
  return { start, end: matchingBrace(code, start) + 1 }
}

export function findPurityDeclarations(source) {
  const code = maskNonCode(source)
  const regex = new RegExp(PURITY_DECLARATION.source, PURITY_DECLARATION.flags)
  const declarations = []
  let match

  while ((match = regex.exec(code))) {
    const nameEnd = match.index + match[0].length
    declarations.push({
      name: match[6],
      purity: match[4],
      line: lineAt(source, match.index),
      body: bodyRange(code, nameEnd)
    })
  }

  return declarations
}

/*
 * Static and name-based: a pure function may not mention a declared effect
 * or an effectful function outside strings, comments, and property access.
 */
export function findPurityViolations(source) {
  const code = maskNonCode(source)
  const declarations = findPurityDeclarations(source)
  const forbidden = [
    ...findEffectDeclarations(source).map(declaration => ({ name: declaration.name, kind: 'effect' })),
    ...declarations
      .filter(declaration => declaration.purity === 'effectful')
      .map(declaration => ({ name: declaration.name, kind: 'effectful function' }))
  ]

  return declarations
    .filter(declaration => declaration.purity === 'pure')
    .flatMap(declaration => {
      const body = code.slice(declaration.body.start, declaration.body.end)

      return forbidden
        .filter(({ name }) => name !== declaration.name)
        .map(({ name, kind }) => ({ kind, name, index: body.search(new RegExp(`(?<![.\\w$])${name}(?![\\w$])`)) }))
        .filter(({ index }) => index !== -1)
        .map(({ name, kind, index }) => ({
          function: declaration.name,
          uses: name,
          kind,
          line: lineAt(source, declaration.body.start + index)
        }))
    })
    .sort((a, b) => a.line - b.line)
}

export function transformPurityModifiers(source) {
  const violation = findPurityViolations(source)[0]
  if (violation) {
    throw new SyntaxError(`pure fn "${violation.function}" uses ${violation.kind} "${violation.uses}" (line ${violation.line})`)
  }

  const code = maskNonCode(source)
  return source.replace(PURITY_DECLARATION, (match, ...args) => {
    const offset = args[args.length - 2]
    if (code.slice(offset, offset + match.length) !== match) return match
    return match.replace(/(pure|effectful)[ \t]+(?=(?:async[ \t]+)?fn[ \t])/, '')
  })
}
