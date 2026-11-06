import { tokenize, significantTokens } from './lexer.js'

/*
 * `match` compiles a value-equality expression construct:
 *
 *   match status {
 *     "ok" => handleOk(),
 *     "error" => handleError(),
 *     _ => handleUnknown()
 *   }
 *
 * into an immediately-invoked arrow function that compares the subject
 * against each pattern with `===`, in order, falling through to the
 * mandatory default `_` arm:
 *
 *   (() => {
 *     const __match = status;
 *     if (__match === ("ok")) return handleOk();
 *     if (__match === ("error")) return handleError();
 *     return handleUnknown();
 *   })()
 *
 * Arms are single expressions (no statement blocks), separated by commas or
 * newlines. Object patterns such as `{ status: "ok", value }` match
 * structurally; any other pattern is compared with `===`. A value-equality
 * match requires a final `_` arm, while a structural match without one
 * throws when nothing matches.
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

/*
 * Distinguishes the `match` keyword from ordinary identifiers named
 * "match" (e.g. `string.match(regex)`, `const match = ...`, a `match`
 * loop variable, or a `match:` object key).
 */
function isMatchKeyword(tokens, index) {
  const token = tokens[index]
  if (token.type !== 'identifier' || token.value !== 'match') return false

  const prev = tokens[index - 1]
  if (prev && (prev.value === '.' || prev.value === 'function' || prev.value === 'class')) {
    return false
  }

  const next = tokens[index + 1]
  if (!next) return false
  if (['(', ':', '=', '.', ',', ')', ']', '}'].includes(next.value)) return false

  return true
}

/*
 * Scans forward from a candidate `match` keyword looking for the subject
 * expression followed by a top-level `{`. Bounded defensively: if the
 * scan leaves the enclosing expression (unbalanced closing bracket) or
 * runs too far without finding `{`, this is not a match construct.
 */
function findMatchBlock(source, tokens, index) {
  let depth = 0
  let braceOpen = -1

  const limit = Math.min(tokens.length, index + 60)

  for (let i = index + 1; i < limit; i++) {
    const value = tokens[i].value
    const prevToken = tokens[i - 1]

    if (prevToken) {
      const gap = source.slice(prevToken.end, tokens[i].start)
      if (depth === 0 && (gap.match(/\n/g) || []).length > 1) return null
    }

    if (value === '(' || value === '[') { depth++; continue }
    if (value === ')' || value === ']') {
      depth--
      if (depth < 0) return null
      continue
    }
    if (value === ';' && depth === 0) return null
    if (value === '{' && depth === 0) { braceOpen = i; break }
  }

  if (braceOpen === -1) return null

  const subjectTokens = tokens.slice(index + 1, braceOpen)
  if (!subjectTokens.length) return null

  let braceDepth = 0
  let braceClose = -1

  for (let j = braceOpen; j < tokens.length; j++) {
    if (tokens[j].value === '{') braceDepth++
    else if (tokens[j].value === '}') {
      braceDepth--
      if (braceDepth === 0) { braceClose = j; break }
    }
  }

  if (braceClose === -1) {
    throw new SyntaxError(`Unclosed match block:\n${text(source, tokens.slice(index, braceOpen + 1))}`)
  }

  return { subjectTokens, braceOpen, braceClose }
}

function isNewlineBetween(source, previous, next) {
  return source.slice(previous.end, next.start).includes('\n')
}

function hasTopLevelArrowBeforeNewline(source, tokens, start) {
  let depth = 0
  for (let i = start; i < tokens.length; i++) {
    if (i > start && depth === 0 && isNewlineBetween(source, tokens[i - 1], tokens[i])) return false
    const value = tokens[i].value
    if (value === '(' || value === '[' || value === '{') depth++
    else if (value === ')' || value === ']' || value === '}') depth--
    else if (value === '=>' && depth === 0) return true
  }
  return false
}

/*
 * A new line starts a new arm only once the current arm has its `=>` and the
 * new line has its own top-level `=>`, so multi-line arm expressions still work.
 */
function splitArms(source, tokens) {
  const result = []
  let start = 0
  let depth = 0
  let seenArrow = false

  for (let i = 0; i < tokens.length; i++) {
    const value = tokens[i].value

    if (
      depth === 0 && seenArrow && i > start &&
      tokens[i - 1].value !== '=>' &&
      isNewlineBetween(source, tokens[i - 1], tokens[i]) &&
      hasTopLevelArrowBeforeNewline(source, tokens, i)
    ) {
      result.push(tokens.slice(start, i))
      start = i
      seenArrow = false
    }

    if (value === '(' || value === '[' || value === '{') depth++
    else if (value === ')' || value === ']' || value === '}') depth--
    else if (value === '=>' && depth === 0) seenArrow = true
    else if (value === ',' && depth === 0) {
      result.push(tokens.slice(start, i))
      start = i + 1
      seenArrow = false
    }
  }

  if (start < tokens.length) result.push(tokens.slice(start))
  return result
}

const LITERAL_IDENTIFIERS = new Set(['true', 'false', 'null', 'undefined'])

function isBindingName(tokens) {
  return tokens.length === 1 &&
    tokens[0].type === 'identifier' &&
    !LITERAL_IDENTIFIERS.has(tokens[0].value)
}

function matchingClose(tokens, openIndex) {
  let depth = 0
  for (let i = openIndex; i < tokens.length; i++) {
    const value = tokens[i].value
    if (value === '(' || value === '[' || value === '{') depth++
    else if (value === ')' || value === ']' || value === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function isObjectPattern(tokens) {
  return tokens[0]?.value === '{' && matchingClose(tokens, 0) === tokens.length - 1
}

/*
 * Inside an object pattern a bare name binds the field, while literals and
 * other expressions are compared with `===`.
 */
function compilePattern(source, tokens, accessor, nested) {
  if (tokens.length === 1 && tokens[0].value === '_') return { conditions: [], bindings: [] }

  if (isObjectPattern(tokens)) return compileObjectPattern(source, tokens, accessor)

  if (nested && isBindingName(tokens)) {
    return { conditions: [], bindings: [[tokens[0].value, accessor]] }
  }

  return { conditions: [`${accessor} === (${text(source, tokens)})`], bindings: [] }
}

function compileObjectPattern(source, tokens, accessor) {
  const conditions = [`${accessor} !== null && typeof ${accessor} === "object"`]
  const bindings = []

  for (const field of splitTopLevelCommas(tokens.slice(1, -1)).filter(group => group.length)) {
    const colon = field.findIndex(token => token.value === ':')
    const keyTokens = colon === -1 ? field : field.slice(0, colon)
    const valueTokens = colon === -1 ? field : field.slice(colon + 1)

    if (keyTokens.length !== 1 || !['identifier', 'string'].includes(keyTokens[0].type) || !valueTokens.length) {
      throw new SyntaxError(`Invalid match pattern field: ${text(source, field)}`)
    }

    const key = keyTokens[0].type === 'string' ? keyTokens[0].value : JSON.stringify(keyTokens[0].value)
    const fieldAccessor = `${accessor}[${key}]`
    const pattern = compilePattern(source, valueTokens, fieldAccessor, true)

    conditions.push(`${key} in ${accessor}`, ...pattern.conditions)
    bindings.push(...pattern.bindings)
  }

  return { conditions, bindings }
}

function parseArms(source, tokens) {
  const groups = splitArms(source, tokens).filter(group => group.length)

  if (!groups.length) {
    throw new SyntaxError('match requires at least one arm')
  }

  return groups.map(group => {
    let depth = 0
    let arrowIndex = -1

    for (let i = 0; i < group.length; i++) {
      const value = group[i].value
      if (value === '(' || value === '[' || value === '{') depth++
      else if (value === ')' || value === ']' || value === '}') depth--
      else if (value === '=>' && depth === 0) { arrowIndex = i; break }
    }

    if (arrowIndex === -1) {
      throw new SyntaxError(`Invalid match arm, expected \`pattern => expression\`:\n${text(source, group)}`)
    }

    const patternTokens = group.slice(0, arrowIndex)
    const pattern = text(source, patternTokens).trim()
    const expression = text(source, group.slice(arrowIndex + 1)).trim()

    if (!pattern || !expression) {
      throw new SyntaxError(`Invalid match arm, expected \`pattern => expression\`:\n${text(source, group)}`)
    }

    return {
      pattern,
      expression,
      structural: isObjectPattern(patternTokens),
      compiled: compilePattern(source, patternTokens, '__match', false)
    }
  })
}

function emitArm({ pattern, expression, compiled: { conditions, bindings } }) {
  if (pattern === '_') return `  return ${expression};`

  const condition = conditions.map(item => conditions.length > 1 ? `(${item})` : item).join(' && ')
  if (!bindings.length) return `  if (${condition}) return ${expression};`

  const declarations = bindings.map(([name, accessor]) => `${name} = ${accessor}`).join(', ')
  return `  if (${condition}) { const ${declarations}; return ${expression}; }`
}

function emitMatch(subject, arms) {
  const defaultIndex = arms.findIndex(arm => arm.pattern === '_')
  const structural = arms.some(arm => arm.structural)

  if (defaultIndex === -1 && !structural) {
    throw new SyntaxError('match requires a default `_` arm')
  }

  if (defaultIndex !== -1 && defaultIndex !== arms.length - 1) {
    throw new SyntaxError('the default `_` arm must be the last arm in match')
  }

  const lines = arms.map(emitArm)
  if (defaultIndex === -1) {
    lines.push("  throw new TypeError('No match arm matched the value');")
  }

  return `(() => {\n  const __match = ${subject};\n${lines.join('\n')}\n})()`
}

export function transformMatchExpressions(source) {
  let result = source

  for (let iteration = 0; iteration < 1000; iteration++) {
    const tokens = significantTokens(tokenize(result))

    let matchIndex = -1
    let block = null

    for (let i = tokens.length - 1; i >= 0; i--) {
      if (!isMatchKeyword(tokens, i)) continue

      const candidate = findMatchBlock(result, tokens, i)
      if (candidate) {
        matchIndex = i
        block = candidate
        break
      }
    }

    if (matchIndex === -1) return result

    const subject = text(result, block.subjectTokens).trim()
    const bodyTokens = tokens.slice(block.braceOpen + 1, block.braceClose)
    const arms = parseArms(result, bodyTokens)
    const replacement = emitMatch(subject, arms)

    const start = tokens[matchIndex].start
    const end = tokens[block.braceClose].end

    result = result.slice(0, start) + replacement + result.slice(end)
  }

  throw new SyntaxError('match transformation exceeded 1000 iterations')
}
