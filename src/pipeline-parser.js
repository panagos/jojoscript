import {
  tokenize,
  significantTokens,
  maskNonCode
} from './lexer.js'

const PIPELINE_STDLIB = new Set([
  'map',
  'filter',
  'sort',
  'unique',
  'take',
  'skip',
  'flatMap',
  'reduce',
  'toArray',
  'count',
  'first',
  'find',
  'some',
  'every',
  'groupBy',
  'partition',
  'chunk',
  'window',
  'zip',
  'zipWith',
  'scan',
  'sortBy',
  'distinctBy',
  'tap',
  'mapAsync',
  'filterAsync',
  'toArrayAsync'
])

/*
 * These stage names are handled at compile time instead of being resolved
 * to a runtime function call, so they must never be added as automatic
 * `jojoscript/runtime` imports.
 */
const PIPELINE_CONTROL_STAGES = new Set(['await', 'catch', 'orElse'])

function text(source, tokens) {
  if (!tokens.length) return ''
  return source.slice(tokens[0].start, tokens[tokens.length - 1].end)
}

function matchingToken(tokens, start, open, close) {
  let depth = 0
  for (let i = start; i < tokens.length; i++) {
    if (tokens[i].value === open) depth++
    if (tokens[i].value === close) {
      depth--
      if (depth === 0) return i
    }
  }
  throw new SyntaxError(`Unclosed ${open}`)
}

function splitArguments(tokens) {
  const result = []
  let start = 0
  let parens = 0
  let braces = 0
  let brackets = 0

  for (let i = 0; i < tokens.length; i++) {
    const value = tokens[i].value
    if (value === '(') parens++
    else if (value === ')') parens--
    else if (value === '{') braces++
    else if (value === '}') braces--
    else if (value === '[') brackets++
    else if (value === ']') brackets--

    if (
      value === ',' &&
      parens === 0 &&
      braces === 0 &&
      brackets === 0
    ) {
      result.push(tokens.slice(start, i))
      start = i + 1
    }
  }

  if (start < tokens.length) result.push(tokens.slice(start))
  return result
}

function parseStage(source, tokens) {
  if (!tokens.length) throw new SyntaxError('Empty pipeline stage')

  if (tokens.every((token, index) =>
    index % 2 === 0
      ? token.type === 'identifier'
      : token.value === '.'
  )) {
    const name = text(source, tokens).trim()
    if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(name)) {
      return { name, args: [] }
    }
  }

  let openIndex = -1
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].value === '(') {
      openIndex = i
      break
    }
  }

  if (openIndex === -1) {
    throw new SyntaxError(`Invalid pipeline stage: ${text(source, tokens)}`)
  }

  const closeIndex = matchingToken(tokens, openIndex, '(', ')')
  if (closeIndex !== tokens.length - 1) {
    throw new SyntaxError(`Invalid pipeline stage: ${text(source, tokens)}`)
  }

  const name = text(source, tokens.slice(0, openIndex)).trim()

  if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(name)) {
    throw new SyntaxError(`Invalid pipeline function: ${name}`)
  }

  const args = splitArguments(
    tokens.slice(openIndex + 1, closeIndex)
  ).map(argument => text(source, argument).trim())

  return { name, args }
}

function parsePipelineStatement(source, statementStart, statementEnd) {
  const statement = source.slice(statementStart, statementEnd)
  const tokens = significantTokens(tokenize(statement))

  const firstPipeIndex = tokens.findIndex(token => token.type === 'pipeline')
  if (firstPipeIndex === -1) return null

  let inputStartIndex = 0
  let parens = 0
  let brackets = 0
  let braces = 0

  for (let i = 0; i < firstPipeIndex; i++) {
    const token = tokens[i]

    if (token.value === '(') { parens++; continue }
    if (token.value === ')') { parens--; continue }
    if (token.value === '[') { brackets++; continue }
    if (token.value === ']') { brackets--; continue }
    if (token.value === '{') { braces++; continue }
    if (token.value === '}') { braces--; continue }

    if (parens === 0 && brackets === 0 && braces === 0) {
      if (token.value === '=' || token.value === '=>' || token.value === ':') {
        inputStartIndex = i + 1
      }
      if (token.type === 'identifier' && token.value === 'return') {
        inputStartIndex = i + 1
      }
    }
  }

  const inputTokens = tokens.slice(inputStartIndex, firstPipeIndex)
  if (!inputTokens.length) {
    throw new SyntaxError(`Pipeline has no input expression:\n${statement}`)
  }

  const expression = text(statement, inputTokens).trim()
  if (!expression) {
    throw new SyntaxError(`Pipeline has no input expression:\n${statement}`)
  }

  const stages = []
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'pipeline') continue

    const stageStart = i + 1
    let stageEnd = tokens.length

    for (let j = stageStart; j < tokens.length; j++) {
      if (tokens[j].type === 'pipeline') {
        stageEnd = j
        break
      }
    }

    const stageTokens = tokens.slice(stageStart, stageEnd)
    if (!stageTokens.length) {
      throw new SyntaxError(`Empty pipeline stage in:\n${statement}`)
    }

    stages.push(parseStage(statement, stageTokens))
    i = stageEnd - 1
  }

  const prefixTokens = tokens.slice(0, inputStartIndex)
  const prefix = prefixTokens.length ? text(statement, prefixTokens).trim() : ''

  return { expression, stages, prefix }
}

export function emitPipeline(pipeline) {
  let expression = pipeline.expression.trim()
  let prefix = pipeline.prefix ? `${pipeline.prefix} ` : ''

  for (const stage of pipeline.stages) {
    if (PIPELINE_CONTROL_STAGES.has(stage.name)) {
      expression = emitControlStage(stage, expression)
      continue
    }

    const placeholderIndex = stage.args.indexOf('_')

    if (placeholderIndex !== -1) {
      const args = stage.args.slice()
      args[placeholderIndex] = expression
      expression = `${stage.name}(${args.join(', ')})`
    } else if (stage.args.length === 0) {
      expression = `${stage.name}(${expression})`
    } else {
      expression = `${stage.name}(${expression}, ${stage.args.join(', ')})`
    }
  }

  return prefix + expression
}

function emitControlStage(stage, expression) {
  if (stage.name === 'await') {
    if (stage.args.length) {
      throw new SyntaxError('the `await` pipeline stage does not take arguments')
    }
    return `(await (${expression}))`
  }

  if (stage.name === 'catch') {
    if (stage.args.length !== 1) {
      throw new SyntaxError('the `catch` pipeline stage takes exactly one handler argument, e.g. `|> catch(handler)`')
    }
    return `(() => { try { return (${expression}) } catch (__error) { return (${stage.args[0]})(__error) } })()`
  }

  if (stage.name === 'orElse') {
    if (stage.args.length !== 1) {
      throw new SyntaxError('the `orElse` pipeline stage takes exactly one fallback argument, e.g. `|> orElse(fallback)`')
    }
    return `(() => { try { return (${expression}) } catch (__error) { return (${stage.args[0]}) } })()`
  }

  throw new SyntaxError(`Unknown pipeline control stage: ${stage.name}`)
}

function findStatementBounds(source, pipe) {
  const mask = maskNonCode(source)

  let start = pipe.start
  let parenDepth = 0
  let bracketDepth = 0
  let braceDepth = 0

  for (let i = pipe.start - 1; i >= 0; i--) {
    const c = mask[i]

    if (c === ')') { parenDepth++; continue }
    if (c === ']') { bracketDepth++; continue }
    if (c === '}') { braceDepth++; continue }

    if (c === '(') {
      if (parenDepth > 0) { parenDepth--; continue }
      start = i + 1
      break
    }
    if (c === '[') {
      if (bracketDepth > 0) { bracketDepth--; continue }
      start = i + 1
      break
    }
    if (c === '{') {
      if (braceDepth > 0) { braceDepth--; continue }
      start = i + 1
      break
    }

    if (parenDepth !== 0 || bracketDepth !== 0 || braceDepth !== 0) continue

    if (c === ';' || c === ',') {
      start = i + 1
      break
    }

    if (c === '\n') {
      let j = i - 1
      while (j >= 0 && [' ', '\t', '\r'].includes(mask[j])) j--
      if (j < 0 || mask[j] === '\n') {
        start = i + 1
        break
      }
    }

    start = i
  }

  while (
    start < pipe.start &&
    [' ', '\t', '\r', '\n'].includes(mask[start])
  ) start++

  let end = source.length
  parenDepth = 0
  bracketDepth = 0
  braceDepth = 0

  for (let i = pipe.end; i < source.length; i++) {
    const c = mask[i]

    if (c === '(') { parenDepth++; continue }
    if (c === ')') {
      if (parenDepth > 0) { parenDepth--; continue }
      end = i
      break
    }
    if (c === '[') { bracketDepth++; continue }
    if (c === ']') {
      if (bracketDepth > 0) { bracketDepth--; continue }
      end = i
      break
    }
    if (c === '{') { braceDepth++; continue }
    if (c === '}') {
      if (braceDepth > 0) { braceDepth--; continue }
      end = i
      break
    }

    if (
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0 &&
      (c === ';' || c === ',')
    ) {
      end = i
      break
    }

    if (
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0 &&
      c === '\n'
    ) {
      let j = i + 1
      while (
        j < source.length &&
        [' ', '\t', '\r'].includes(mask[j])
      ) j++

      if (mask.slice(j, j + 2) === '|>') continue
      end = i
      break
    }
  }

  return { start, end }
}

export function transformPipelines(source) {
  let result = source

  for (let iteration = 0; iteration < 1000; iteration++) {
    const tokens = significantTokens(tokenize(result))
    const pipes = tokens.filter(token => token.type === 'pipeline')

    if (!pipes.length) return result

    const pipe = pipes[pipes.length - 1]
    const bounds = findStatementBounds(result, pipe)
    const pipeline = parsePipelineStatement(result, bounds.start, bounds.end)

    if (!pipeline) {
      throw new SyntaxError(
        `Unable to parse pipeline:\n\n${result.slice(bounds.start, bounds.end)}`
      )
    }

    const replacement = emitPipeline(pipeline)

    result =
      result.slice(0, bounds.start) +
      replacement +
      result.slice(bounds.end)
  }

  throw new SyntaxError('Pipeline transformation exceeded 1000 iterations')
}

export function findPipelineStdlibFunctions(source) {
  const tokens = significantTokens(tokenize(source))
  const result = new Set()

  for (let i = 0; i < tokens.length - 1; i++) {
    if (
      tokens[i].type === 'pipeline' &&
      tokens[i + 1].type === 'identifier' &&
      PIPELINE_STDLIB.has(tokens[i + 1].value)
    ) {
      result.add(tokens[i + 1].value)
    }
  }

  return [...result]
}

export { parsePipelineStatement, findStatementBounds }
