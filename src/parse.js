import { maskNonCode } from './lexer.js'
import { findAllPipelines } from './pipeline-parser.js'
import { inferPipelineName } from './pipeline-explain.js'
import { findNamedPipelines, transformNamedPipelines } from './named-pipelines.js'
import { findEffectDeclarations, findHandleBlocks } from './effect-parser.js'
import { findTypeDeclarations } from './type-declarations.js'
import { findContracts } from './contracts.js'
import { findMatchExpressions } from './match-parser.js'

const PARSE_VERSION = '1'
const IMPORT = /^[ \t]*import\s+([^'"]+?)\s+from\s+(["'])([^"']+)\2/gm
const FUNCTION = /^[ \t]*(export[ \t]+)?(?:(async)[ \t]+)?(?:(pure|effectful)[ \t]+)?(?:(async)[ \t]+)?fn[ \t]+([A-Za-z_$][\w$]*)[ \t]*\(/gm

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length
}

function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if ('([{'.includes(text[i])) depth++
    else if (')]}'.includes(text[i])) depth--
    else if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  if (text.trim()) parts.push(text.slice(start).trim())
  return parts
}

function matchingParen(code, open) {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++
    else if (code[i] === ')' && --depth === 0) return i
  }
  return code.length
}

function parseImports(source, code) {
  return [...source.matchAll(IMPORT)]
    .filter(match => code.startsWith('import', match.index + match[0].search(/import/)))
    .map(match => ({
      kind: 'import',
      line: lineAt(source, match.index),
      from: match[3],
      names: splitTopLevel(match[1].replace(/[{}]/g, ',')).filter(Boolean)
    }))
}

function parseFunctions(source, code) {
  const contracts = findContracts(source)

  return [...code.matchAll(FUNCTION)].map(match => {
    const [head, exportPart, asyncBefore, purity, asyncAfter, name] = match
    const open = match.index + head.length - 1
    const close = matchingParen(code, open)
    const restOfLine = code.slice(close + 1).split('\n')[0]
    const line = lineAt(source, match.index + head.search(/\S/))
    const contract = contracts.find(item => item.name === name && item.line === line)

    return {
      kind: 'function',
      line,
      name,
      params: splitTopLevel(source.slice(open + 1, close)),
      exported: Boolean(exportPart),
      async: Boolean(asyncBefore || asyncAfter),
      purity: purity ?? null,
      body: /^\s*(?::[^={]*)?=(?![=>])/.test(restOfLine) ? 'expression' : 'block',
      requires: contract?.requires.map(clause => clause.condition) ?? [],
      ensures: contract?.ensures.map(clause => clause.condition) ?? []
    }
  })
}

/*
 * Named pipeline blocks are analyzed through their compiled `fn` form, which
 * keeps every line in place, so their nodes report the `pipeline` line.
 */
function parsePipelines(rawSource) {
  const source = transformNamedPipelines(rawSource)
  const declared = findNamedPipelines(rawSource)

  return findAllPipelines(source).map(pipeline => {
    const name = inferPipelineName(source, pipeline)
    const startLine = lineAt(source, pipeline.start)
    const block = declared.find(item => item.name === name && item.line < startLine)

    return {
      kind: 'pipeline',
      line: block ? block.line : startLine,
      name,
      declared: Boolean(block),
      source: pipeline.expression,
      stages: pipeline.stages.map(stage => ({ type: stage.name, args: stage.args, id: stage.id ?? null }))
    }
  })
}

export function parseSource(source) {
  const code = maskNonCode(source)

  const nodes = [
    ...parseImports(source, code),
    ...findEffectDeclarations(source).map(effect => ({ kind: 'effect', line: lineAt(source, effect.start), name: effect.name, params: effect.params })),
    ...findTypeDeclarations(source).map(type => ({
      kind: 'type',
      line: lineAt(source, type.start + type.indent.length),
      name: type.name,
      exported: type.exported,
      variants: type.variants
    })),
    ...parseFunctions(source, code),
    ...parsePipelines(source),
    ...findHandleBlocks(source).map(block => ({ kind: 'handle', line: lineAt(source, block.start), handlers: block.handlerNames })),
    ...findMatchExpressions(source).map(match => ({ kind: 'match', line: match.line, patterns: match.arms.map(arm => arm.pattern) }))
  ]

  return { language: 'jojo', version: PARSE_VERSION, nodes: nodes.sort((a, b) => a.line - b.line) }
}
