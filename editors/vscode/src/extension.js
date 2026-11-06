const vscode = require('vscode')

/*
 * formatter.mjs is an identical copy of the package's src/formatter.js (a
 * test enforces it), loaded with import() because this extension is CommonJS.
 */
function activate(context) {
  const provider = {
    async provideDocumentFormattingEdits(document, options) {
      const { formatSource } = await import('./formatter.mjs')
      const originalText = document.getText()
      const indent = options.insertSpaces === false ? '\t' : ' '.repeat(options.tabSize || 2)
      const formatted = formatSource(originalText, { indent })
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

module.exports = { activate, deactivate }
