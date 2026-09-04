import { tokenize, significantTokens, maskNonCode } from './lexer.js'

/*
 * Algebraic effects / effect handlers, source-level syntax:
 *
 *   effect fetchUser(id)
 *
 *   handle {
 *     fetchUser: id => http.get(`/users/${id}`)
 *   } {
 *     users |> map(user => fetchUser(user.id))
 *   }
 *
 * Both constructs compile to plain calls into the `@panagos/jojoscript/runtime`
 * effect runtime (`defineEffect`/`withHandlers`), following the same
 * "regex/token transform, no real AST" philosophy as `match-parser.js` and
 * `transforms.js` rather than introducing a parallel parsing architecture.
 */

function text(source, tokens) {
  if (!tokens.length) return ''
  return source.slice(tokens[0].start, tokens[tokens.length - 1].end)
}

/*
 * Only applies `regex` to matches that are real code (not inside a string,
 * template literal, or comment). Mirrors `transforms.js`'s private
 * `codeAwareReplace` helper; duplicated here (rather than exported from
 * `transforms.js`) to keep each transform module self-contained.
 */
function codeAwareReplace(source, regex, replacer) {
  const mask = maskNonCode(source)

  return source.replace(regex, (...args) => {
    const match = args[0]
    const offset = args[args.length - 2]

    if (mask.slice(offset, offset + match.length) !== match) {
      return match
    }

    return replacer(...args)
  })
}

/*
 * A deliberately simple, single-line declaration: `effect name(params)`,
 * optionally `export`ed. Parameter names are plain identifiers (no default
 * values/destructuring/nested parens) — enough to declare an effect's
 * shape without needing a full expression parser.
 */
const EFFECT_DECLARATION = /^([ \t]*)(export\s+)?effect\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^()]*)\)\s*;?[ \t]*$/gm

function splitParams(params) {
  return params.trim() ? params.split(',').map(p => p.trim()).filter(Boolean) : []
}

/*
 * Static scan for `effect name(params)` declarations. Used both by the
 * compiler (to know which runtime imports are needed) and by pipeline
 * inspection (`pipeline-ir.js`) to recognize effect names referenced from
 * inside pipeline stages.
 */
export function findEffectDeclarations(source) {
  const mask = maskNonCode(source)
  const regex = new RegExp(EFFECT_DECLARATION.source, EFFECT_DECLARATION.flags)
  const results = []
  let match

  while ((match = regex.exec(source))) {
    const offset = match.index
    if (mask.slice(offset, offset + match[0].length) !== match[0]) continue

    results.push({
      name: match[3],
      params: splitParams(match[4]),
      start: offset,
      end: offset + match[0].length
    })
  }

  return results
}

export function transformEffectDeclarations(source) {
  return codeAwareReplace(source, EFFECT_DECLARATION, (match, indent, exportPart, name, params) => {
    const paramList = JSON.stringify(splitParams(params))
    return `${indent}${exportPart || ''}const ${name} = defineEffect(${JSON.stringify(name)}, ${paramList})`
  })
}

/*
 * Distinguishes the `handle` keyword from ordinary identifiers named
 * "handle" (e.g. `stream.handle(...)`, `const handle = ...`).
 */
function isHandleKeyword(tokens, index) {
  const token = tokens[index]
  if (token.type !== 'identifier' || token.value !== 'handle') return false

  const prev = tokens[index - 1]
  if (prev && ['.', 'const', 'let', 'var', 'function', 'class'].includes(prev.value)) return false

  const next = tokens[index + 1]
  if (!next || next.value !== '{') return false

  return true
}

function matchingBrace(tokens, openIndex) {
  let depth = 0
  for (let i = openIndex; i < tokens.length; i++) {
    if (tokens[i].value === '{') depth++
    else if (tokens[i].value === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  throw new SyntaxError('Unclosed `handle` block')
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

function extractHandlerNames(source, tokens) {
  return splitTopLevelCommas(tokens)
    .filter(group => group.length)
    .map(group => {
      const first = group[0]
      if (first.type === 'identifier') return first.value
      if (first.type === 'string') return first.value.slice(1, -1)
      throw new SyntaxError(`Invalid handler entry in \`handle { ... }\`: ${text(source, group)}`)
    })
}

function locateHandleBlock(tokens, index) {
  const handlerOpen = index + 1
  const handlerClose = matchingBrace(tokens, handlerOpen)

  const bodyOpen = handlerClose + 1
  if (!tokens[bodyOpen] || tokens[bodyOpen].value !== '{') {
    throw new SyntaxError('`handle { ... }` must be followed by a body block: `handle { ... } { ... }`')
  }
  const bodyClose = matchingBrace(tokens, bodyOpen)

  return { keywordIndex: index, handlerOpen, handlerClose, bodyOpen, bodyClose }
}

/*
 * Static scan for every `handle { handlers } { body }` block in `source`,
 * used both by the compiler and by pipeline inspection (which handler
 * names are statically declared, for a best-effort "is this effect
 * handled?" signal).
 */
export function findHandleBlocks(source) {
  const tokens = significantTokens(tokenize(source))
  const blocks = []

  for (let i = 0; i < tokens.length; i++) {
    if (!isHandleKeyword(tokens, i)) continue

    const block = locateHandleBlock(tokens, i)
    blocks.push({
      start: tokens[block.keywordIndex].start,
      end: tokens[block.bodyClose].end,
      handlerNames: extractHandlerNames(source, tokens.slice(block.handlerOpen + 1, block.handlerClose))
    })
  }

  return blocks
}

/*
 * `handle { handlers } { body }` compiles to:
 *
 *   (await withHandlers({ handlers }, async () => { body }))
 *
 * Processes the rightmost (innermost, for nested `handle` blocks) match
 * first on every iteration, same strategy as `transformMatchExpressions`,
 * so nested handlers compile inside-out.
 */
export function transformHandleBlocks(source) {
  let result = source

  for (let iteration = 0; iteration < 1000; iteration++) {
    const tokens = significantTokens(tokenize(result))

    let target = null
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (!isHandleKeyword(tokens, i)) continue
      target = locateHandleBlock(tokens, i)
      break
    }

    if (!target) return result

    const handlerText = text(result, tokens.slice(target.handlerOpen, target.handlerClose + 1))
    const bodyText = text(result, tokens.slice(target.bodyOpen, target.bodyClose + 1))
    const replacement = `(await withHandlers(${handlerText}, async () => ${bodyText}))`

    const start = tokens[target.keywordIndex].start
    const end = tokens[target.bodyClose].end

    result = result.slice(0, start) + replacement + result.slice(end)
  }

  throw new SyntaxError('handle transformation exceeded 1000 iterations')
}
