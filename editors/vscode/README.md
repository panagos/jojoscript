# JojoScript Language Support

Syntax highlighting and a document formatter for JojoScript (`.jojo`) files.

## Features

- Syntax highlighting for JojoScript-specific constructs on top of full
  JavaScript highlighting: `:=` / `mutable :=` declarations, `fn`
  block/expression functions, the `match` expression, the `|>` pipeline
  operator, the `_` placeholder argument, and optional parameter/return
  type annotations.
- `Format Document` support (line-based reindentation): normalizes
  indentation from brace/bracket/paren nesting, indents pipeline (`|>`)
  continuations and multi-line `:=` right-hand sides one extra level, trims
  trailing whitespace, and collapses excess blank lines. It intentionally
  does not rewrite expressions — JojoScript's own compiler has no AST
  either (see `src/compiler.js` in the main package).

## Try it

```bash
cd editors/vscode
npm install -g @vscode/vsce   # or use npx @vscode/vsce
vsce package
code --install-extension jojoscript-language-0.1.0.vsix
```

Or press `F5` from this folder in VS Code to launch an Extension
Development Host with the extension loaded.

## Known limitations

Shared with the compiler (see "Known limitations" in the main package README):
no regex-literal awareness, so a `/.../ ` regex containing `{`, `}`, `(` or
`)` can throw off indentation/highlighting depth tracking.
