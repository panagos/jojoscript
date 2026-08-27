import {
  tokenize,
  significantTokens,
  maskNonCode
} from './lexer.js'

import { computePipelineId } from './pipeline-hash.js'

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
  'toArrayAsync',
  'checkpoint',
  'inspect',
  'parallel',
  'batch',
  'retry'
])

/*
 * These stages are "runtime-aware": the compiler auto-appends a hidden,
 * literal metadata argument (pipeline id, stable node id, stage type) to
 * their call so the runtime operator can identify itself for
 * checkpointing/profiling/error-reporting without the user ever writing
 * that plumbing by hand.
 */
const RUNTIME_AWARE_STAGES = new Set(['checkpoint', 'inspect', 'parallel', 'batch'])

/*
 * A `retry(...)` stage immediately following one of these fuses into that
 * stage's function argument (per-item retry) instead of becoming its own
 * pipeline stage. See `fuseRetryStages`.
 */
const MAP_LIKE_STAGES = new Set(['map', 'mapAsync', 'filterAsync', 'tap'])

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

function metaLiteral(pipelineId, nodeId, type, extra = {}) {
  return JSON.stringify({ id: nodeId, pipelineId, type, ...extra })
}

/*
 * A bare integer shorthand (`retry(3)`) becomes `{ attempts: 3 }`; anything
 * else (an object literal, a variable holding options, ...) is passed
 * through untouched and assumed to already be options-shaped at runtime.
 */
function normalizeRetryOptions(args) {
  if (args.length === 0) {
    throw new SyntaxError('retry expects an attempt count or an options object, e.g. `retry(3)` or `retry({ attempts: 3 })`')
  }
  if (args.length > 1) {
    throw new SyntaxError('retry takes exactly one argument: an attempt count or an options object')
  }

  const arg = args[0].trim()
  return /^\d+$/.test(arg) ? `{ attempts: ${arg} }` : arg
}

/*
 * `retry(...)` immediately following a `map`/`mapAsync`/`filterAsync`/
 * `tap` stage fuses into that stage's function argument, so each *item* is
 * retried independently (`map(items, retry(fn, opts, meta))`) instead of
 * retry meaninglessly wrapping an already-lazy, not-yet-run generator.
 * With no such preceding stage, `retry` instead wraps the whole expression
 * built so far as a standalone stage (handled in the main emission loop).
 */
function fuseRetryStages(stages, pipelineId) {
  const result = []

  for (const stage of stages) {
    if (stage.name !== 'retry') {
      result.push(stage)
      continue
    }

    const options = normalizeRetryOptions(stage.args)
    const previous = result[result.length - 1]

    if (previous && MAP_LIKE_STAGES.has(previous.name) && previous.args.length) {
      const meta = metaLiteral(pipelineId, stage.nodeId, 'retry')
      const lastIndex = previous.args.length - 1
      previous.args[lastIndex] = `retry(${previous.args[lastIndex]}, ${options}, ${meta})`
      continue
    }

    result.push({ ...stage, args: [options], standaloneRetry: true })
  }

  return result
}

export function emitPipeline(pipeline, options = {}) {
  let expression = pipeline.expression.trim()
  let prefix = pipeline.prefix ? `${pipeline.prefix} ` : ''

  const pipelineId = computePipelineId(pipeline)

  const checkpointOrder = pipeline.stages
    .filter(stage => stage.name === 'checkpoint' && stage.args.length)
    .map(stage => stripQuotes(stage.args[0]))

  let checkpointsSeen = 0

  const stagesWithIds = pipeline.stages.map((stage, index) => ({
    ...stage,
    nodeId: `node-${index + 1}`
  }))

  const stages = fuseRetryStages(stagesWithIds, pipelineId)

  if (options.profile) {
    expression = `traceNode(${expression}, ${metaLiteral(pipelineId, 'node-0', 'source')})`
  }

  for (const stage of stages) {
    if (PIPELINE_CONTROL_STAGES.has(stage.name)) {
      expression = emitControlStage(stage, expression)
      continue
    }

    if (stage.name === 'retry' && stage.standaloneRetry) {
      const meta = metaLiteral(pipelineId, stage.nodeId, 'retry')
      expression = `(await retry(async () => (${expression}), ${stage.args[0]}, ${meta})())`
      if (options.profile) {
        expression = `traceNode(${expression}, ${metaLiteral(pipelineId, stage.nodeId, 'retry')})`
      }
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

    if (RUNTIME_AWARE_STAGES.has(stage.name)) {
      const extra = stage.name === 'checkpoint'
        ? { checkpointOrder, checkpointIndex: checkpointsSeen++ }
        : {}
      const meta = metaLiteral(pipelineId, stage.nodeId, stage.name, extra)
      expression = expression.slice(0, -1) + `, ${meta})`
    }

    if (options.profile) {
      expression = `traceNode(${expression}, ${metaLiteral(pipelineId, stage.nodeId, stage.name)})`
    }
  }

  return prefix + expression
}

function stripQuotes(text) {
  const trimmed = text.trim()
  return /^["'`]/.test(trimmed) ? trimmed.slice(1, -1) : trimmed
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
      let j = i + 1
      while (j < pipe.start && [' ', '\t', '\r'].includes(mask[j])) j++
      if (mask.slice(j, j + 2) !== '|>' && mask[j] !== '.') {
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

export function transformPipelines(source, options = {}) {
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

    const replacement = emitPipeline(pipeline, options)

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

/*
 * True if the source contains at least one pipeline statement. Used by the
 * compiler to decide whether the `traceNode` profiling helper needs to be
 * auto-imported, independent of which (if any) stdlib stages are used.
 */
export function hasPipelines(source) {
  const tokens = significantTokens(tokenize(source))
  return tokens.some(token => token.type === 'pipeline')
}

/*
 * Non-mutating forward scan collecting every pipeline statement in the
 * source, used for static analysis (`jojo graph`) rather than compilation.
 * Unlike `transformPipelines` (which repeatedly processes the *last* pipe
 * in the whole file so nested pipelines-in-arguments resolve inside-out),
 * this simply walks forward statement-by-statement, which is sufficient
 * for the common case of top-level `|>` chains that graph/profile display.
 */
export function findAllPipelines(source) {
  const pipelines = []
  let searchFrom = 0

  while (searchFrom < source.length) {
    const remainder = source.slice(searchFrom)
    const tokens = significantTokens(tokenize(remainder))
    const pipe = tokens.find(token => token.type === 'pipeline')
    if (!pipe) break

    const absolutePipe = { ...pipe, start: pipe.start + searchFrom, end: pipe.end + searchFrom }
    const bounds = findStatementBounds(source, absolutePipe)
    const pipeline = parsePipelineStatement(source, bounds.start, bounds.end)

    if (pipeline) {
      pipelines.push({ ...pipeline, start: bounds.start, end: bounds.end })
    }

    searchFrom = Math.max(bounds.end, absolutePipe.end) + 1
  }

  return pipelines
}

export { parsePipelineStatement, findStatementBounds }

