# JojoScript 0.7.0

JojoScript is a deliberately small source-to-source language that adds a
handful of ergonomic constructs on top of JavaScript while keeping ordinary
JavaScript valid. The compiler is a regex/token-based transpiler (not a full
AST), so it stays tiny and every feature composes with plain JavaScript
around it.

See [CHANGELOG.md](CHANGELOG.md) for release history and
[example/](example/) for a complete runnable application that exercises
every feature described below.

## Install

```bash
npm install jojoscript
```

## CLI

```bash
jojo build <file.jojo|directory> [--out <directory>] [--watch]
jojo run <file.jojo> [--out <directory>]
jojo --version
jojo --help
```

- `jojo build src` compiles every `.jojo` file under `src` to `src/dist/*.js` (or `--out <dir>`).
- `jojo build src --watch` rebuilds whenever a `.jojo` file under `src` changes.
- `jojo run app.jojo` compiles a single file and immediately runs it with Node — useful for a fast dev loop.
- Compiler and filesystem errors are reported as a single friendly line (`jojo: <message>`, exit code 1) instead of a raw stack trace. Unknown flags are rejected.

## Language features

### Immutable declaration

```jojo
users := getUsers()
```

becomes:

```js
const users = getUsers()
```

### Mutable declaration

```jojo
mutable count := 0
count++
```

becomes:

```js
let count = 0
count++
```

Existing JavaScript `const`, `let`, and `var` declarations are untouched.

### Destructuring declarations

Object and array patterns are supported with `:=` and `mutable :=`. Only the
declaration head is rewritten — the right-hand side is left completely
untouched and may span multiple lines.

```jojo
{ id, name } := getUser()
[head, ...rest] := items
mutable { count } := state
```

becomes:

```js
const { id, name } = getUser()
const [head, ...rest] = items
let { count } = state
```

### Multi-binding (tuple) declarations

A comma-separated list of names before `:=` destructures a comma-separated
list of values on the right-hand side (single line only):

```jojo
a, b := 1, 2
mutable x, y := 10, 20
```

becomes:

```js
const [a, b] = [1, 2]
let [x, y] = [10, 20]
```

This is a distinct construct from bracket destructuring: use `a, b := 1, 2`
to bind a fixed list of values, and `[a, b] := getPair()` to destructure a
single array-producing expression.

### Functions

Block functions:

```jojo
fn add(a, b) {
  return a + b
}
```

Expression functions:

```jojo
fn double(value) = value * 2
```

Async functions:

```jojo
async fn loadUsers() {
  return await getUsers()
}
```

### Optional type annotations

Parameters and return values can be annotated. Annotations are **never
checked** — they are stripped from the emitted JavaScript and re-expressed
as a JSDoc block above the function, so editors/tools that understand JSDoc
get parameter and return type information without JojoScript needing its own
type checker.

```jojo
fn add(a: number, b: number): number { return a + b }
```

becomes:

```js
/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function add(a, b) { return a + b; }
```

Functions with no annotations are left completely untouched.

### `match` expression

`match` compares a subject against each pattern with `===`, in order, and
requires a default `_` arm as the last arm. Arms are single expressions
(not statement blocks).

```jojo
label := match status {
  200 => "OK",
  404 => "Not Found",
  _ => "Unknown"
}
```

becomes:

```js
const label = (() => {
  const __match = status;
  if (__match === (200)) return "OK";
  if (__match === (404)) return "Not Found";
  return "Unknown";
})()
```

Patterns can be arbitrary expressions, which enables range-style matching
against `true`:

```jojo
category := match true {
  value > 100 => "large",
  value > 10 => "medium",
  _ => "small"
}
```

`match` is a value-equality construct, not structural pattern matching:
patterns are plain expressions compared with `===`.

### Pipelines

```jojo
users
  |> filter(isAdult)
  |> map(normalize)
  |> sort(byName)
  |> take(10)
```

becomes nested JavaScript calls:

```js
take(sort(map(filter(users, isAdult), normalize), byName), 10)
```

A stage can have no arguments (`users |> unique`) or arguments
(`users |> take(10)`), and normal JavaScript expressions can be pipeline
inputs, including `await` expressions and pipelines inside `return`
statements, function bodies, and object literals.

#### Placeholder argument

By default the piped value is inserted as the stage's first argument. The
`_` placeholder lets you put it anywhere in the argument list instead:

```jojo
value |> divide(100, _)
```

becomes:

```js
divide(100, value)
```

#### `catch` / `orElse` control stages

`catch` and `orElse` provide inline error handling without leaving pipeline
syntax. Both wrap the preceding pipeline in a try/catch, compiled as an
immediately-invoked arrow function:

```jojo
risky() |> catch(error => fallbackFor(error))
risky() |> orElse(0)
```

`catch(handler)` calls `handler(error)` and returns its result; `orElse(fallback)`
returns `fallback` directly. Both require exactly one argument.

#### `await` control stage

`|> await` unwraps a promise at the end of a pipeline, so an async pipeline
still reads as a single chain:

```jojo
return ids
  |> mapAsync(id => repository.findById(id))
  |> toArrayAsync
  |> await
```

`await`, `catch`, and `orElse` are resolved at compile time and are never
added to the automatic `jojoscript/runtime` import.

### Standard pipeline runtime

The following pipeline stages are supplied by `jojoscript/runtime`. The
compiler automatically generates only the runtime imports that are actually
used through pipeline syntax (custom/user-defined stages are never
auto-imported):

| Stage | Kind | Description |
|---|---|---|
| `map` | lazy | Transform each item |
| `filter` | lazy | Keep items matching a predicate |
| `take` | lazy | Keep the first N items |
| `skip` | lazy | Discard the first N items |
| `unique` | lazy | Remove duplicates (by `===`) |
| `flatMap` | lazy | Map then flatten one level |
| `distinctBy` | lazy | Remove duplicates by a derived key |
| `tap` | lazy | Observe each item without changing the pipeline (side effects/debugging) |
| `chunk` | lazy | Group items into fixed-size arrays |
| `window` | lazy | Yield a sliding view of size N |
| `zip` | lazy | Pair items from two iterables, stopping at the shorter one |
| `zipWith` | lazy | Combine items from two iterables with an arity-2 combining function, stopping at the shorter one |
| `scan` | lazy | Yield a running accumulation (like `reduce`, but yields every step) |
| `mapAsync` | lazy, async | Like `map`, awaiting an async transform |
| `filterAsync` | lazy, async | Like `filter`, awaiting an async predicate |
| `sort` | eager | Materializes the input; sorting needs the complete input |
| `sortBy` | eager | Like `sort`, ordered by a derived key |
| `groupBy` | eager | Groups items into a `Map` keyed by a derived key |
| `partition` | eager | Splits into `[matching, nonMatching]` arrays |
| `reduce` | terminal | Accumulate to a single value |
| `toArray` | terminal | Materialize an iterator into an array |
| `toArrayAsync` | terminal, async | Materialize an async iterator into an array |
| `count` | terminal | Count items |
| `first` | terminal | First item, or `undefined` |
| `find` | terminal | First matching item, or `undefined` |
| `some` | terminal | Whether any item matches (short-circuits) |
| `every` | terminal | Whether every item matches (short-circuits) |

See [ITERATOR_PROPOSAL.md](ITERATOR_PROPOSAL.md) and [ITERATORS.md](ITERATORS.md)
for the full laziness/memory model.

## JavaScript compatibility

JojoScript intentionally leaves ordinary JavaScript alone. You can use:

- normal `const`, `let`, and `var`
- arrow functions
- classes
- destructuring (as plain JS assignment, not a `:=` declaration)
- spread/rest
- optional chaining
- nullish coalescing
- template literals
- loops
- try/catch
- array methods
- async/await
- built-in Node modules
- npm/bare imports

Local relative imports receive `.js` after compilation:

```jojo
import { users } from "./users"
```

becomes:

```js
import { users } from "./users.js"
```

Bare imports remain untouched:

```jojo
import axios from "axios"
```

## Runtime package

Generated JavaScript imports the runtime using the package subpath:

```js
import { map, take } from "jojoscript/runtime"
```

The package exposes this through `package.json` `exports`, so consumers
install `jojoscript` as a normal dependency. If a file both manually imports
from `jojoscript/runtime` (for a stage that's only ever called directly,
never through `|>`) and also uses pipeline syntax with overlapping names,
the compiler merges the auto-imported names into the existing import
instead of emitting a second, colliding import declaration.

## Example

See [example/](example/). It is a complete runnable project covering every
language feature above plus JavaScript compatibility: a Node/SQLite
application that fetches posts from a public API, stores them, and prints a
report, alongside one small focused module (and test) per feature. Every
module is imported and invoked from `example/src/main.jojo`, so both
`npm start` and `npm test` exercise the whole example.

```bash
cd example
npm install
npm run build
npm start
npm test
```

## Iterator pipelines

Collection pipeline stages are lazy by default. `map`, `filter`, `take`,
`skip`, `unique`, `flatMap`, `distinctBy`, `tap`, `chunk`, `window`, `zip`,
`zipWith`, `scan`, `mapAsync`, and `filterAsync` return iterators (or async iterators)
instead of allocating an intermediate array. Use `toArray`/`toArrayAsync`
when an array is actually required.

```jojo
const total = users
  |> filter(user => user.active)
  |> map(user => user.age)
  |> reduce((sum, age) => sum + age, 0)
```

`sort`, `sortBy`, `groupBy`, and `partition` are intentionally materialization
boundaries because they need the complete input. See
[ITERATORS.md](ITERATORS.md) for the complete proposal and memory model.

## Editor support

See [editors/vscode](editors/vscode) for a VS Code extension providing syntax
highlighting and a `Format Document` provider for `.jojo` files. It is not
published to the marketplace; package it with `vsce package` and install the
resulting `.vsix` locally.

## Known limitations

- **No source maps.** Stack traces from compiled `dist/*.js` point at the
  generated JavaScript, not the original `.jojo` source.
- **No `jojo fmt` CLI command.** Formatting is only available through the
  VS Code extension's `Format Document` command, not the `jojo` CLI.
- **No regex-literal awareness in the lexer.** A regex containing `{`, `}`,
  `(`, or `)` can confuse brace/paren-depth-sensitive transforms (pipelines,
  `match`, destructuring, type annotations). Prefer `new RegExp(...)` in code
  paths that also use these constructs on the same line, or keep such regexes
  simple.
- **Pipeline statement boundaries need a blank line (or a semicolon) between
  consecutive `:=` statements that each end in a bare pipeline stage**, e.g.:

  ```jojo
  a := x |> map(f)
  b := y |> map(g)   // may be parsed as a continuation of the line above
  ```

  Add a blank line (or a trailing `;`) between them.
- **`match` subject expressions should be simple** (a single identifier,
  member access, or a fully-parenthesized expression) and appear on the same
  statement as the `{ ... }` block.
- **Multi-binding declarations (`a, b := 1, 2`) are single-line only** and
  always wrap the right-hand side in `[...]`; use `[a, b] := expr()` to
  destructure a single expression instead.

