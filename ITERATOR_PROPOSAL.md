# JojoScript Iterator Pipeline Proposal — 0.5.0

## 1. Problem

The original collection runtime implemented pipeline stages using array methods. A chain such as:

```jojo
source |> filter(predicate) |> map(transform) |> take(10)
```

could allocate an array after `filter`, another after `map`, and only then discard most of those values in `take`.

For large datasets this creates avoidable memory pressure and work.

## 2. Decision

Make streaming-compatible pipeline stages lazy by default.

The compiler syntax does not change. The existing pipeline syntax is still compiled into nested runtime calls. The runtime implementation changes the evaluation model.

## 3. Lazy stages

`map`, `filter`, `take`, `skip`, `unique`, and `flatMap` return iterators.

They do not execute their callbacks until the returned iterator is consumed.

## 4. Terminal stages

`reduce`, `toArray`, `count`, `first`, `find`, `some`, and `every` consume an iterable.

Several of them short-circuit, so they can avoid traversing the remainder of the source.

## 5. Materialization boundary

`sort` remains eager because sorting needs the complete input. It explicitly converts the iterable to an array before sorting.

`toArray` is the explicit general-purpose materialization operation.

## 6. JavaScript compatibility

Ordinary JavaScript is untouched:

```js
const result = values.map(x => x * 2)
```

The iterator semantics only apply to Jojo pipeline stages that resolve to the Jojo runtime functions.

## 7. Memory characteristics

For a streaming pipeline consisting only of lazy stages and a short-circuiting terminal:

```jojo
source |> filter(predicate) |> map(transform) |> take(10) |> toArray
```

intermediate collection storage is O(1), apart from iterator state and callback state.

`unique` requires O(k) memory for the distinct values encountered.

`sort` requires O(n) additional storage.

## 8. `reduce`

`reduce` was missing from the original runtime and is now included as a terminal stage.

Both forms are supported:

```jojo
values |> reduce((sum, value) => sum + value, 0)
values |> reduce((sum, value) => sum + value)
```

The second form uses the first element as the initial accumulator and throws for an empty iterable.

## 9. Iterator protocol

Runtime stages accept any JavaScript iterable and also support an iterator object with `next()`.

This means arrays, Sets, generators, generator functions, and custom iterable objects can be pipeline sources.

## 10. Deliberate non-goals

- No new pipeline syntax is introduced.
- No special collection type is exposed to Jojo programs.
- No attempt is made to make arbitrary JavaScript array methods lazy.
- `sort` is not made lazy because doing so would obscure its unavoidable full-input requirement.

## 11. Future extension points

The runtime can later add more streaming stages such as `chunk`, `window`, `zip`, or `scan` without changing the pipeline grammar.
