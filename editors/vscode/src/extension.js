const vscode = require('vscode')

function activate(context) {
  const provider = {
    provideDocumentFormattingEdits(document, options) {
      const originalText = document.getText()
      const formatted = formatJojoScript(originalText, options)
      if (formatted === originalText) return []

      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(originalText.length)
      )
      return [vscode.TextEdit.replace(fullRange, formatted)]
    }
  }

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider('jojoscript', provider)
  )
}

function deactivate() {}

/*
 * A line-based reindenter for JojoScript source.
 *
 * JojoScript's own compiler (see ../../src/compiler.js) is a regex/token
 * pipeline, not an AST-based transpiler, so this formatter matches that
 * philosophy instead of pretending to be a full pretty-printer: it only
 * normalizes indentation and stray whitespace, it never rewrites
 * expressions.
 *
 * It:
 *  - reindents lines based on brace/bracket/paren nesting depth
 *  - adds one extra indent level to lines that continue a pipeline (`|>`)
 *  - adds one extra indent level to lines that continue a `:=` declaration
 *    whose right-hand side starts on the following line(s), until a blank
 *    line ends the statement
 *  - trims trailing whitespace from every line
 *  - collapses runs of 3+ blank lines down to a single blank line
 *  - ensures the file ends with exactly one trailing newline
 *
 * It leaves the contents of block comments and the literal text portions of
 * template literals untouched (only `${...}` interpolations are reindented).
 * Like the compiler itself, it is not regex-literal aware: a `/.../ ` regex
 * containing `{`, `}`, `(` or `)` can throw off the brace/paren depth count.
 */
function formatJojoScript(text, options) {
  const indentUnit = options && options.insertSpaces === false
    ? '\t'
    : ' '.repeat((options && options.tabSize) || 2)

  const lines = text.split(/\r\n|\r|\n/)
  const stack = []
  let inBlockComment = false
  let hanging = false
  const output = []

  function scanLine(line) {
    let i = 0
    while (i < line.length) {
      if (inBlockComment) {
        const end = line.indexOf('*/', i)
        if (end === -1) return
        inBlockComment = false
        i = end + 2
        continue
      }

      const top = stack[stack.length - 1]
      if (top === 'TPL') {
        const ch = line[i]
        if (ch === '\\') { i += 2; continue }
        if (ch === '`') { stack.pop(); i++; continue }
        if (ch === '$' && line[i + 1] === '{') { stack.push('{'); i += 2; continue }
        i++
        continue
      }

      const two = line.substr(i, 2)
      const ch = line[i]

      if (two === '//') return
      if (two === '/*') { inBlockComment = true; i += 2; continue }
      if (ch === '`') { stack.push('TPL'); i++; continue }

      if (ch === '"' || ch === "'") {
        const quote = ch
        i++
        while (i < line.length) {
          if (line[i] === '\\') { i += 2; continue }
          if (line[i] === quote) { i++; break }
          i++
        }
        continue
      }

      if (ch === '{' || ch === '[' || ch === '(') { stack.push(ch); i++; continue }
      if (ch === '}' || ch === ']' || ch === ')') {
        if (stack.length && stack[stack.length - 1] !== 'TPL') stack.pop()
        i++
        continue
      }

      i++
    }
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()

    if (trimmed === '') {
      output.push('')
      hanging = false
      continue
    }

    const opaque = inBlockComment || (stack.length > 0 && stack[stack.length - 1] === 'TPL')
    const startDepth = stack.reduce((n, s) => n + (s === 'TPL' ? 0 : 1), 0)
    const startsWithCloser = /^[}\])]/.test(trimmed)

    if (opaque) {
      output.push(rawLine)
    } else {
      let level = startDepth
      if (startsWithCloser) level = Math.max(0, level - 1)
      if (trimmed.startsWith('|>')) level += 1
      if (hanging) level += 1
      output.push(indentUnit.repeat(level) + trimmed)
    }

    if (!opaque && startsWithCloser) hanging = false
    if (!opaque && /:=$/.test(trimmed)) hanging = true
    else if (!opaque && /\{$/.test(trimmed)) hanging = false

    scanLine(rawLine)
  }

  const collapsed = []
  let blankRun = 0
  for (const line of output) {
    if (line === '') {
      blankRun++
      if (blankRun > 1) continue
    } else {
      blankRun = 0
    }
    collapsed.push(line)
  }

  while (collapsed.length && collapsed[0] === '') collapsed.shift()
  while (collapsed.length && collapsed[collapsed.length - 1] === '') collapsed.pop()

  return collapsed.join('\n') + '\n'
}

module.exports = { activate, deactivate }
