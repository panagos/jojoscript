import { maskNonCode } from './lexer.js'

/*
 * Applies `regex.replace` only to matches that are real code, i.e. matches
 * that do not overlap a string, template literal or comment. This prevents
 * jojo syntax that merely *looks* like source code (inside a string a
 * comment) from being rewritten.
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
 * Expression functions capture everything up to the end of the physical
 * line as the body, which may include a trailing `// comment`. Splitting it
 * out keeps the comment from swallowing the generated closing brace, e.g.
 *   fn double(x) = x * 2 // doubles the value
 * must not become:
 *   function double(x) { return x * 2 // doubles the value; }
 */
function splitTrailingComment(expression) {
  const mask = maskNonCode(expression, { comments: false })
  const index = mask.indexOf('//')

  if (index === -1) {
    return { code: expression, comment: '' }
  }

  return {
    code: expression.slice(0, index).trimEnd(),
    comment: expression.slice(index)
  }
}

export function transformExpressionFunctions(source) {
  const mask = maskNonCode(source)

  return source.replace(
    /^([ \t]*)(export\s+)?(async\s+)?fn\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)\s*=\s*(.+)$/gm,
    (match, indent, exportPart, asyncPart, name, args, expression, offset) => {
      /*
       * Only validate the part of the match that can never legitimately
       * contain a string/comment (indent + export/async + "fn name(").
       * The parameter list and expression body are allowed to contain
       * real string/template literals (e.g. a default value that calls
       * a function returning a string), so they must not be compared
       * against the mask.
       */
      const keywordLength = match.indexOf('(') + 1

      if (mask.slice(offset, offset + keywordLength) !== match.slice(0, keywordLength)) {
        return match
      }

      const { code, comment } = splitTrailingComment(expression)
      const suffix = comment ? ` ${comment}` : ''
      return `${indent}${exportPart || ''}${asyncPart || ''}function ${name}(${args}) { return ${code}; }${suffix}`
    }
  )
}

export function transformFunctionDeclarations(source) {
  return codeAwareReplace(
    codeAwareReplace(
      source,
      /\basync\s+fn\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g,
      (_, name) => `async function ${name}(`
    ),
    /\bfn\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g,
    (_, name) => `function ${name}(`
  )
}

export function transformMutableDeclarations(source) {
  return codeAwareReplace(
    source,
    /(^|\n)([ \t]*)(export\s+)?mutable\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*:=/g,
    (_, before, indent, exportPart, name) => `${before}${indent}${exportPart || ''}let ${name} =`
  )
}

export function transformConstDeclarations(source) {
  return codeAwareReplace(
    source,
    /(^|\n)([ \t]*)(export\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*:=/g,
    (_, before, indent, exportPart, name) => `${before}${indent}${exportPart || ''}const ${name} =`
  )
}

/*
 * Tuple/multi-binding declarations:
 *   a, b := 1, 2            -> const [a, b] = [1, 2]
 *   mutable a, b := 1, 2    -> let [a, b] = [1, 2]
 *
 * The right-hand side is captured as the remainder of the physical line
 * and wrapped in `[...]` verbatim, so this sugar is intentionally limited
 * to single-line right-hand sides. Use `[a, b] := someArrayExpr()` (see
 * `transformDestructuringDeclarations`) to destructure a single expression
 * instead.
 */
export function transformMultiBindingDeclarations(source) {
  const mask = maskNonCode(source)

  return source.replace(
    /^([ \t]*)(export\s+)?(mutable\s+)?([A-Za-z_$][A-Za-z0-9_$]*(?:\s*,\s*[A-Za-z_$][A-Za-z0-9_$]*)+)\s*:=[ \t]*(.+)$/gm,
    (match, indent, exportPart, mutablePart, names, rhs, offset) => {
      const headLength = match.length - rhs.length

      if (mask.slice(offset, offset + headLength) !== match.slice(0, headLength)) {
        return match
      }

      const keyword = mutablePart ? 'let' : 'const'
      const list = names.split(',').map(name => name.trim())
      const { code, comment } = splitTrailingComment(rhs)
      const suffix = comment ? ` ${comment}` : ''

      return `${indent}${exportPart || ''}${keyword} [${list.join(', ')}] = [${code.trim()}]${suffix}`
    }
  )
}

/*
 * Finds the index of `close` matching the `open` bracket already known to
 * be at `mask[start]`, scanning the mask so brackets inside strings,
 * template literals and comments are ignored.
 */
function findMatchingBracket(mask, start, open, close) {
  let depth = 0

  for (let i = start; i < mask.length; i++) {
    if (mask[i] === open) depth++
    else if (mask[i] === close) {
      depth--
      if (depth === 0) return i
    }
  }

  return -1
}

/*
 * Recognizes an object/array destructuring declaration head at `start`,
 * which must be the beginning of a line (ignoring leading whitespace):
 *   { a, b } := getUser()          -> const { a, b } = getUser()
 *   mutable [a, ...rest] := items  -> let [a, ...rest] = items
 *
 * Only the declaration head (indent, `export`/`mutable`, pattern, `:=`) is
 * matched and rewritten; the right-hand side is left completely untouched,
 * so it may span multiple lines just like plain `:=`/`mutable :=`.
 */
function matchDestructuringHead(source, mask, start) {
  let i = start

  while (source[i] === ' ' || source[i] === '\t') i++
  const indent = source.slice(start, i)

  let exportPart = ''
  if (source.startsWith('export', i) && /\s/.test(source[i + 6] || '')) {
    let j = i + 6
    while (/\s/.test(source[j])) j++
    exportPart = source.slice(i, j)
    i = j
  }

  let isMutable = false
  if (source.startsWith('mutable', i) && /\s/.test(source[i + 7] || '')) {
    let j = i + 7
    while (/\s/.test(source[j])) j++
    isMutable = true
    i = j
  }

  const openChar = source[i]
  if ((openChar !== '{' && openChar !== '[') || mask[i] !== openChar) return null

  const closeChar = openChar === '{' ? '}' : ']'
  const patternStart = i
  const closeIndex = findMatchingBracket(mask, i, openChar, closeChar)
  if (closeIndex === -1) return null

  const patternEnd = closeIndex + 1
  let k = patternEnd
  while (/\s/.test(source[k] || '')) k++
  if (source[k] !== ':' || source[k + 1] !== '=') return null

  return {
    indent,
    exportPart,
    mutable: isMutable,
    pattern: source.slice(patternStart, patternEnd),
    end: k + 2
  }
}

export function transformDestructuringDeclarations(source) {
  const mask = maskNonCode(source)
  let result = ''
  let i = 0

  while (i < source.length) {
    const atLineStart = i === 0 || source[i - 1] === '\n'

    if (!atLineStart) {
      result += source[i]
      i++
      continue
    }

    const head = matchDestructuringHead(source, mask, i)

    if (!head) {
      result += source[i]
      i++
      continue
    }

    const keyword = head.mutable ? 'let' : 'const'
    result += `${head.indent}${head.exportPart}${keyword} ${head.pattern} =`
    i = head.end
  }

  return result
}

export function transformLocalImports(source) {
  const replacer = (_, prefix, specifier, quote) =>
    prefix + normalizeLocalSpecifier(specifier) + quote

  return [
    /(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,
    /(import\s+["'])(\.{1,2}\/[^"']+)(["'])/g,
    /(import\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g
  ].reduce(
    (result, regex) => codeAwareReplaceIgnoringComments(result, regex, replacer),
    source
  )
}

/*
 * Like codeAwareReplace, but only guards against matches inside comments.
 * Local import specifiers legitimately live inside string literals, so
 * strings must stay eligible for replacement here.
 */
function codeAwareReplaceIgnoringComments(source, regex, replacer) {
  const mask = maskNonCode(source, { strings: false })

  return source.replace(regex, (...args) => {
    const match = args[0]
    const offset = args[args.length - 2]

    if (mask.slice(offset, offset + match.length) !== match) {
      return match
    }

    return replacer(...args)
  })
}

function normalizeLocalSpecifier(specifier) {
  if (specifier.endsWith('.jojo')) {
    specifier = specifier.slice(0, -'.jojo'.length)
  }

  if (!specifier.endsWith('.js')) {
    specifier += '.js'
  }

  return specifier
}
