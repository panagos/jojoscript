export function tokenize(source) {
  const tokens = []
  let i = 0

  while (i < source.length) {
    const start = i
    const c = source[i]

    if (/\s/.test(c)) {
      i++
      continue
    }

    if (source.startsWith('//', i)) {
      i += 2
      while (i < source.length && source[i] !== '\n') i++
      continue
    }

    if (source.startsWith('/*', i)) {
      i += 2
      while (i < source.length && !source.startsWith('*/', i)) i++
      if (i < source.length) i += 2
      continue
    }

    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      i++
      let templateExpressionDepth = 0
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (quote === '`' && source.startsWith('${', i)) {
          templateExpressionDepth++
          i += 2
          continue
        }
        if (quote === '`' && source[i] === '}' && templateExpressionDepth > 0) {
          templateExpressionDepth--
          i++
          continue
        }
        if (source[i] === quote && templateExpressionDepth === 0) {
          i++
          break
        }
        i++
      }
      tokens.push({ type: 'string', value: source.slice(start, i), start, end: i })
      continue
    }

    if (/[A-Za-z_$]/.test(c)) {
      i++
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) i++
      tokens.push({ type: 'identifier', value: source.slice(start, i), start, end: i })
      continue
    }

    if (/[0-9]/.test(c)) {
      i++
      while (i < source.length && /[A-Za-z0-9_.$]/.test(source[i])) i++
      tokens.push({ type: 'number', value: source.slice(start, i), start, end: i })
      continue
    }

    const operators = [
      '>>>=' , '===', '!==', '**=', '&&=', '||=', '??=',
      '=>', '|>', '?.', '??', '==', '!=', '<=', '>=',
      '&&', '||', '**', '++', '--', '+=', '-=', '*=', '/=',
      '%=', '...', '<<', '>>', '>>>', '?.'
    ]

    const op = operators.find(value => source.startsWith(value, i))
    if (op) {
      tokens.push({
        type: op === '|>' ? 'pipeline' : 'operator',
        value: op,
        start,
        end: i + op.length
      })
      i += op.length
      continue
    }

    tokens.push({ type: 'punctuation', value: c, start, end: i + 1 })
    i++
  }

  return tokens
}

export function significantTokens(tokens) {
  return tokens
}

/*
 * Produces a same-length copy of `source` where the contents of comments
 * and/or string/template literals are replaced with blank spaces (newlines
 * are preserved so line-based/anchored regexes keep working).
 *
 * This lets regex-based transforms and character scanners check "is this
 * position real code?" by comparing against the mask, without having to
 * duplicate string/comment-parsing logic everywhere.
 */
export function maskNonCode(source, options = {}) {
  const maskStrings = options.strings !== false
  const maskComments = options.comments !== false

  let mask = ''
  let i = 0

  while (i < source.length) {
    if (source.startsWith('//', i)) {
      const start = i
      while (i < source.length && source[i] !== '\n') i++
      mask += maskComments ? blank(source, start, i) : source.slice(start, i)
      continue
    }

    if (source.startsWith('/*', i)) {
      const start = i
      i += 2
      while (i < source.length && !source.startsWith('*/', i)) i++
      if (i < source.length) i += 2
      mask += maskComments ? blank(source, start, i) : source.slice(start, i)
      continue
    }

    const c = source[i]

    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      const start = i
      i++
      let templateExpressionDepth = 0
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (quote === '`' && source.startsWith('${', i)) {
          templateExpressionDepth++
          i += 2
          continue
        }
        if (quote === '`' && source[i] === '}' && templateExpressionDepth > 0) {
          templateExpressionDepth--
          i++
          continue
        }
        if (source[i] === quote && templateExpressionDepth === 0) {
          i++
          break
        }
        i++
      }
      mask += maskStrings ? blank(source, start, i) : source.slice(start, i)
      continue
    }

    mask += c
    i++
  }

  return mask
}

function blank(source, start, end) {
  let result = ''
  for (let i = start; i < end; i++) {
    result += source[i] === '\n' ? '\n' : ' '
  }
  return result
}
