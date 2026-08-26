# Changelog

## Unreleased

## 0.7.1 — Fix runtime import path after publishing under a scoped name

### Compiler

- Fixed the auto-generated pipeline runtime import (`import { map, ... } from "jojoscript/runtime"`) being hardcoded to the unscoped literal `jojoscript`, which broke once the package was published as `@panagos/jojoscript`. The import specifier is now derived from the package's own `package.json` name at compile time, so it always matches however the package is actually installed.

## 0.7.0 — `zipWith` lazy stage

### Runtime

- Added the lazy stage `zipWith`, like `zip` but combining corresponding elements with an arity-2 combining function instead of yielding `[a, b]` pairs. Neither source is materialized, so both may be infinite/lazy.

### Editor

- Added a VS Code extension under `editors/vscode` providing syntax highlighting (`:=`, `mutable`, `fn`, `match`, `|>`, `_` placeholder, type annotations, layered on top of full JavaScript highlighting) and a `Format Document` provider that reindents based on brace/bracket/paren nesting, `|>` continuations, and multi-line `:=` right-hand sides.

## 0.6.0 — Destructuring, `match`, types, pipeline control stages, CLI

### Language

- Added destructuring declarations: `{ a, b } := getUser()`, `[head, ...rest] := items`, and their `mutable` equivalents. The right-hand side is untouched, so it may span multiple lines.
- Added tuple/multi-binding declarations: `a, b := 1, 2` and `mutable a, b := 1, 2` (single-line right-hand side, wrapped in an array).
- Added the `match` expression: a value-equality construct compiling to a chain of `===` comparisons with a mandatory, must-be-last default `_` arm. Supports nesting and pipelines inside arm expressions.
- Added optional type annotations on `fn` parameters and return values (`fn add(a: number, b: number): number { ... }`). Annotations are never checked; they are stripped from the emitted JavaScript and re-expressed as a JSDoc block above the function.
- Added the `_` placeholder argument for pipeline stages, controlling where the piped value is inserted instead of always being the first argument (e.g. `value |> divide(100, _)`).
- Added the `catch` and `orElse` pipeline control stages for inline error handling (`risky() |> catch(handler)`, `risky() |> orElse(fallback)`), compiled to a try/catch IIFE.
- Added the `await` pipeline control stage (`|> await`) to unwrap a promise at the end of a pipeline without leaving pipeline syntax.
- Fixed a parser limitation where expression-function parameter lists (`fn f(a = g(h(x))) = a`) failed to parse defaults with more than one level of nested parentheses.

### Runtime

- Added lazy stages `distinctBy`, `tap`, `chunk`, `window`, `zip`, `scan`, and `mapAsync`/`filterAsync` (async generators).
- Added eager stages `groupBy`, `partition`, and `sortBy`.
- Added the `toArrayAsync` terminal for async iterator pipelines.

### Compiler

- Fixed a bug where a file that both manually imports from `jojoscript/runtime` and uses pipeline syntax with the same stage names would get two colliding import declarations for the same names. Auto-imported names are now merged into an existing manual import instead.

### CLI

- Added `--version`/`-v`.
- Added `jojo run <file.jojo>`, which compiles and immediately executes a file with Node.
- Added `jojo build --watch`, which rebuilds on `.jojo` file changes.
- Compiler and filesystem errors are now reported as a single friendly `jojo: <message>` line (exit code 1) instead of a raw stack trace. Unknown flags are now rejected instead of silently ignored.

### Example app

- Fixed `declaration-example.jojo`, which compiled to invalid JavaScript (`mutable counter = 0` was missing `:=`) and was never caught because nothing imported or tested it.
- Fixed `collection-showcase.jojo`, which manually imported the same names it also used through pipelines, producing a duplicate-import `SyntaxError` in the compiled output; this was never caught because its only test lived in a `.test.jojo` file that `node --test test/*.test.js` never matched.
- Replaced that broken `test/collection-runtime.test.jojo` with `test/collection-showcase.test.js`, which imports the compiled output the same way every other example test does.
- Added a dedicated test for `declaration-example.jojo`.
- Added one new example module and test per new language/runtime feature (destructuring, `match`, typed functions, pipeline placeholder, pipeline error handling, async pipelines, collection extras), all imported and invoked from `main.jojo` so `npm start` exercises them in addition to `npm test`.

### Known limitations (not addressed in this release)

- No source maps: stack traces point at the compiled `dist/*.js`, not the original `.jojo` source.
- No formatter (`jojo fmt`).
- No syntax highlighting/editor grammar for `.jojo` files.
- The lexer has no concept of regex literals, so a regex containing `{`, `}`, `(` or `)` can confuse brace/paren-depth-sensitive transforms (pipelines, `match`, destructuring, type annotations). This is a pre-existing limitation, not something introduced in 0.6.0.
- Consecutive `:=` statements that each end in a bare pipeline stage need a blank line between them unless separated by a semicolon (a pre-existing `pipeline-parser.js` statement-boundary heuristic).

## 0.5.0 — Iterator pipelines

- Added lazy iterator implementations for `map`, `filter`, `take`, `skip`, `unique`, and `flatMap`.
- Added terminal operations `reduce`, `toArray`, `count`, `first`, `find`, `some`, and `every`.
- Kept `sort` as an eager/materializing stage.
- Added automatic runtime imports for all iterator stdlib stages.
- Added iterator-focused language/runtime tests.
- Expanded the example application with lazy pipelines and `reduce`.
- Preserved ordinary JavaScript array methods and other JavaScript syntax unchanged.
