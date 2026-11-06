import { maskNonCode } from './lexer.js'

const PIPELINE_HEAD = /^([ \t]*)(export[ \t]+)?pipeline[ \t]+([A-Za-z_$][\w$]*)[ \t]*\{/gm
const SOURCE_LINE = /^([ \t]*)source[ \t]+(.+?)[ \t]*$/

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length
}

function matchingBrace(code, openIndex) {
  let depth = 0
  for (let i = openIndex; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}' && --depth === 0) return i
  }
  throw new SyntaxError('Unclosed pipeline block')
}

/*
 * `pipeline name { source input |> stages }` is a named, reusable pipeline.
 * An identifier source becomes the function's single input parameter.
 */
export function findNamedPipelines(source) {
  const code = maskNonCode(source)
  const regex = new RegExp(PIPELINE_HEAD.source, PIPELINE_HEAD.flags)
  const pipelines = []
  let match

  while ((match = regex.exec(code))) {
    const [head, indent, exportPart, name] = match
    const bodyOpen = match.index + head.length - 1
    const bodyClose = matchingBrace(code, bodyOpen)
    const lines = source.slice(bodyOpen + 1, bodyClose).split('\n')

    const sourceIndex = lines.findIndex(line => line.trim())
    const sourceLine = sourceIndex === -1 ? null : lines[sourceIndex].match(SOURCE_LINE)
    if (!sourceLine) throw new SyntaxError(`pipeline "${name}" must start with "source <expression>"`)

    const stageLines = lines.slice(sourceIndex + 1).filter(line => line.trim())
    if (!stageLines.length) throw new SyntaxError(`pipeline "${name}" has no stages`)

    const expression = sourceLine[2]
    pipelines.push({
      name,
      inputs: /^[A-Za-z_$][\w$]*$/.test(expression) ? [expression] : [],
      expression,
      exported: Boolean(exportPart),
      async: /\bawait\b/.test(code.slice(bodyOpen, bodyClose)),
      line: lineAt(source, match.index + indent.length),
      indent,
      sourceIndent: sourceLine[1],
      stageLines,
      // The first and last entries are the rest of the `{` line and the start of the `}` line.
      blankLines: Math.max(0, lines.length - 3 - stageLines.length),
      start: match.index,
      end: bodyClose + 1
    })
  }

  return pipelines
}

/*
 * Blank lines would split the returned pipeline into separate statements, so
 * they move to the end of the block, which keeps its total line count.
 */
export function transformNamedPipelines(source) {
  let result = source

  for (const pipeline of findNamedPipelines(source).reverse()) {
    const exportPart = pipeline.exported ? 'export ' : ''
    const asyncPart = pipeline.async ? 'async ' : ''
    const body = [
      `${pipeline.sourceIndent}return ${pipeline.expression}`,
      ...pipeline.stageLines,
      ...Array(pipeline.blankLines).fill('')
    ].join('\n')

    const replacement =
      `${pipeline.indent}${exportPart}${asyncPart}fn ${pipeline.name}(${pipeline.inputs.join(', ')}) {\n${body}\n${pipeline.indent}}`

    result = result.slice(0, pipeline.start) + replacement + result.slice(pipeline.end)
  }

  return result
}
