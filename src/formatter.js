/*
 * A line-based reindenter, matching the compiler's no-AST design: it only
 * normalizes indentation and whitespace and never rewrites expressions.
 * The VS Code extension ships an identical copy (editors/vscode/src/formatter.mjs).
 *
 * Every open bracket remembers the indent level of the line that opened it,
 * so a line opening several brackets (`reduce((a, b) => {`) indents its
 * contents once. Block comments and template literal text are left
 * untouched. Like the compiler, it is not regex-literal aware.
 */
const PIPELINE_BLOCK = /^(?:export\s+)?pipeline\s+[A-Za-z_$][\w$]*\s*\{$/

function continuationLevels(trimmed, insidePipelineBlock) {
  if (trimmed.startsWith('|>')) return insidePipelineBlock ? 0 : 1
  if (/^(requires|ensures)\b/.test(trimmed)) return 1
  if (/^\|(?![|>])/.test(trimmed)) return 1
  if (/^[?:](?![?:.])/.test(trimmed)) return 1
  if (/^\.(?!\.)/.test(trimmed)) return 1
  return 0
}

export function formatSource(text, options = {}) {
  const indentUnit = options.indent ?? '  '
  const stack = []
  const output = []
  let inBlockComment = false
  let hangingDepth = null

  const openBrackets = () => stack.filter(entry => entry.ch !== 'TPL')

  function scanLine(line, level) {
    let i = 0
    while (i < line.length) {
      if (inBlockComment) {
        const end = line.indexOf('*/', i)
        if (end === -1) return
        inBlockComment = false
        i = end + 2
        continue
      }

      const ch = line[i]
      if (stack.at(-1)?.ch === 'TPL') {
        if (ch === '\\') i += 2
        else if (ch === '`') { stack.pop(); i++ }
        else if (ch === '$' && line[i + 1] === '{') { stack.push({ ch: '{', level }); i += 2 }
        else i++
        continue
      }

      const two = line.slice(i, i + 2)
      if (two === '//') return
      if (two === '/*') { inBlockComment = true; i += 2; continue }
      if (ch === '`') { stack.push({ ch: 'TPL' }); i++; continue }

      if (ch === '"' || ch === "'") {
        i++
        while (i < line.length && line[i] !== ch) i += line[i] === '\\' ? 2 : 1
        i++
        continue
      }

      if ('{[('.includes(ch)) stack.push({ ch, level, pipeline: ch === '{' && PIPELINE_BLOCK.test(line.trim()) })
      else if ('}])'.includes(ch) && stack.length && stack.at(-1).ch !== 'TPL') stack.pop()
      i++
    }
  }

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const trimmed = rawLine.trim()

    if (trimmed === '') {
      output.push('')
      hangingDepth = null
      continue
    }

    if (inBlockComment || stack.at(-1)?.ch === 'TPL') {
      output.push(rawLine)
      scanLine(rawLine, 0)
      continue
    }

    const open = openBrackets()
    const innermost = open.at(-1)
    const startsWithCloser = /^[}\])]/.test(trimmed)

    let level = innermost ? innermost.level + (startsWithCloser ? 0 : 1) : 0
    if (!startsWithCloser) level += continuationLevels(trimmed, innermost?.pipeline)
    if (hangingDepth === open.length && !startsWithCloser) level += 1

    output.push(indentUnit.repeat(level) + trimmed)

    if (startsWithCloser || /\{$/.test(trimmed)) hangingDepth = null
    if (/(:=|=>)$/.test(trimmed)) hangingDepth = open.length

    scanLine(rawLine, level)
  }

  const collapsed = output.filter((line, index) => line !== '' || output[index - 1] !== '')
  while (collapsed[0] === '') collapsed.shift()
  while (collapsed.at(-1) === '') collapsed.pop()

  return collapsed.join('\n') + '\n'
}
