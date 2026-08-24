import { tokenize, significantTokens } from './lexer.js'

/*
 * Optional, opt-in type annotations for `fn` parameters and return values:
 *
 *   fn add(a: number, b: number): number { return a + b }
 *   fn double(value: number): number = value * 2
 *
 * Annotations are never checked. They are stripped from the emitted
 * JavaScript and re-expressed as a JSDoc block immediately above the
 * function, so editors/tools that understand JSDoc (including plain
 * Node/TypeScript-in-JS tooling) get parameter and return type
 * information "for free" without JojoScript needing its own type checker:
 *
 *   /**
 *    * @param {number} a
 *    * @param {number} b
 *    * @returns {number}
 *    * /
 *   function add(a, b) { return a + b }
 *
 * Functions without any annotations are left completely untouched.
 */

function text(source, tokens) {
  if (!tokens.length) return ''
  return source.slice(tokens[0].start, tokens[tokens.length - 1].end)
}

function splitTopLevelCommas(tokens) {
  const result = []
  let start = 0
  let depth = 0

  for (let i = 0; i < tokens.length; i++) {
    const value = tokens[i].value
    if (value === '(' || value === '[' || value === '{') depth++
    else if (value === ')' || value === ']' || value === '}') depth--
    else if (value === ',' && depth === 0) {
      result.push(tokens.slice(start, i))
      start = i + 1
    }
  }

  if (start < tokens.length) result.push(tokens.slice(start))
  return result
}

function findTopLevel(tokens, value) {
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const v = tokens[i].value
    if (v === '(' || v === '[' || v === '{') depth++
    else if (v === ')' || v === ']' || v === '}') depth--
    else if (v === value && depth === 0) return i
  }
  return -1
}

function parseParameter(source, tokens) {
  const colonIndex = findTopLevel(tokens, ':')

  if (colonIndex === -1) {
    const code = text(source, tokens).trim()
    return { code, type: null }
  }

  const nameTokens = tokens.slice(0, colonIndex)
  const afterColon = tokens.slice(colonIndex + 1)
  const equalsIndex = findTopLevel(afterColon, '=')

  const typeTokens = equalsIndex === -1 ? afterColon : afterColon.slice(0, equalsIndex)
  const defaultTokens = equalsIndex === -1 ? [] : afterColon.slice(equalsIndex)

  const name = text(source, nameTokens).trim()
  const type = text(source, typeTokens).trim()
  const code = defaultTokens.length
    ? `${name} ${text(source, defaultTokens).trim()}`
    : name

  return { code, name, type: type || null }
}

function jsdocBlock(params, returnType, indent) {
  const lines = ['/**']

  for (const param of params) {
    if (param.type) {
      lines.push(` * @param {${param.type}} ${param.name}`)
    }
  }

  if (returnType) {
    lines.push(` * @returns {${returnType}}`)
  }

  lines.push(' */')
  return lines.map(line => `${indent}${line}`).join('\n')
}

function findFnCandidates(tokens) {
  const candidates = []

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'identifier' || tokens[i].value !== 'fn') continue

    const prev = tokens[i - 1]
    if (prev && prev.value === '.') continue

    const nameToken = tokens[i + 1]
    const parenToken = tokens[i + 2]
    if (!nameToken || nameToken.type !== 'identifier') continue
    if (!parenToken || parenToken.value !== '(') continue

    candidates.push({ fnIndex: i, parenIndex: i + 2 })
  }

  return candidates
}

export function transformTypeAnnotations(source) {
  const tokens = significantTokens(tokenize(source))
  const candidates = findFnCandidates(tokens)
  const replacements = []

  for (const candidate of candidates) {
    let depth = 0
    let closeIndex = -1

    for (let i = candidate.parenIndex; i < tokens.length; i++) {
      const value = tokens[i].value
      if (value === '(') depth++
      else if (value === ')') {
        depth--
        if (depth === 0) { closeIndex = i; break }
      }
    }

    if (closeIndex === -1) continue

    const paramTokens = tokens.slice(candidate.parenIndex + 1, closeIndex)
    const hasParamTypes = findTopLevel(paramTokens, ':') !== -1

    let returnType = null
    let end = tokens[closeIndex].end

    const afterClose = tokens[closeIndex + 1]
    if (afterClose && afterClose.value === ':') {
      let j = closeIndex + 2
      while (j < tokens.length && tokens[j].value !== '{' && tokens[j].value !== '=') j++
      if (j < tokens.length) {
        returnType = text(source, tokens.slice(closeIndex + 2, j)).trim()
        end = tokens[j].start
      }
    }

    if (!hasParamTypes && !returnType) continue

    const params = splitTopLevelCommas(paramTokens)
      .filter(group => group.length)
      .map(group => parseParameter(source, group))

    const paramList = params.map(param => param.code).join(', ')

    const fnStart = tokens[candidate.fnIndex].start
    const lineStart = source.lastIndexOf('\n', fnStart - 1) + 1
    const indentMatch = source.slice(lineStart, fnStart).match(/^[ \t]*/)
    const indent = indentMatch ? indentMatch[0] : ''

    const doc = jsdocBlock(params, returnType, indent)
    const headerPrefix = source.slice(lineStart, tokens[candidate.parenIndex].start + 1)
    const tail = returnType ? ') ' : ')'

    replacements.push({
      start: lineStart,
      end,
      text: `${doc}\n${headerPrefix}${paramList}${tail}`
    })
  }

  if (!replacements.length) return source

  replacements.sort((a, b) => b.start - a.start)

  let result = source
  for (const replacement of replacements) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end)
  }

  return result
}
