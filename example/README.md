# JojoScript Clean Architecture Example

This is a runnable Node/SQLite application that fetches posts from a public
API, stores them, and prints a report — built entirely with JojoScript. It
also doubles as a living showcase of every JojoScript language feature: every
module under `src/application/` is imported and invoked from
[`src/main.jojo`](src/main.jojo), and every module additionally has its own
test in `test/` that imports the compiled output from `dist/`. Running
`npm test` (which builds first) or `npm start` exercises the entire example,
so nothing here is dead code.

## Running it

```bash
npm install
npm run build   # compiles src/**/*.jojo -> dist/**/*.js
npm start        # runs dist/main.js (fetches real data over the network)
npm test          # builds, then runs every test/*.test.js against dist/
```

## Feature showcase modules

| Module | Feature | Notes |
|---|---|---|
| `application/declaration-example.jojo` | `:=` / `mutable :=` | Const vs. mutable declarations |
| `application/destructuring-example.jojo` | Destructuring & multi-binding declarations | `{ a, b } := x`, `[h, ...t] := x`, `a, b := 1, 2` |
| `application/match-example.jojo` | `match` expression | Value/boolean-pattern matching with a default `_` arm |
| `application/typed-functions.jojo` | Optional type annotations | Compiled to JSDoc, never checked at compile time |
| `application/pipeline-placeholder-example.jojo` | Pipeline `_` placeholder | Controls where the piped value lands in a stage's arguments |
| `application/pipeline-error-handling-example.jojo` | Pipeline `catch` / `orElse` | Inline error handling without leaving pipeline syntax |
| `application/async-pipeline-example.jojo` | `mapAsync` / `filterAsync` / `toArrayAsync` / `\|> await` | Async iterator pipelines |
| `application/collection-extras.jojo` | `groupBy`, `partition`, `chunk`, `window`, `zip`, `scan`, `sortBy`, `distinctBy`, `tap` | Additional collection runtime stages |
| `application/collection-showcase.jojo` | Core collection runtime | See table below |
| `application/language-edge-cases.jojo` | Compiler edge cases | Pipelines as arguments/array/object values, expression fns, dynamic import |
| `application/greeting.jojo` / `post-service.jojo` / `domain/post.jojo` / `infrastructure/**` | The actual application | Fetch, persist and report on posts |

## Runtime collection showcase

`src/application/collection-showcase.jojo` intentionally exercises the original
collection runtime:

| Operation | Example use |
|---|---|
| `map` | Project post titles / word counts |
| `filter` | Select published posts |
| `sort` | Order posts and titles |
| `unique` | Remove duplicate tags/titles |
| `take` | Select a page/top N |
| `skip` | Skip the first result for pagination |
| `flatMap` | Flatten post tag arrays |
| `reduce` | Calculate total word count |
| `toArray` | Materialize iterator results |
| `count` | Count posts |
| `first` | Get newest post |
| `find` | Locate a post by ID |
| `some` | Detect a long post |
| `every` | Validate that every post has a title |

The example deliberately uses pipelines so the runtime operations are composed
as iterator transformations rather than manually allocating intermediate arrays.

