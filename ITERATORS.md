# JojoScript Iterator Pipelines

## Goal

JojoScript pipelines now use lazy iterators for collection stages that can stream their input. This avoids creating an intermediate array for every `map`/`filter`/`take` step.

For example:

```jojo
users
  |> filter(user => user.active)
  |> map(normalizeUser)
  |> take(100)
  |> toArray
```

The pipeline is evaluated element-by-element. `toArray` is the explicit materialization boundary.

Property access is also supported in pipeline stages when the result of the
preceding pipeline should be used as the receiver of a JavaScript member:

```jojo
name
  |> .trim()
  |> .toUpperCase()
  |> .slice(0, 8)
```

This compiles to ordinary JavaScript member access and method calls without
changing the rest of the pipeline syntax.

## Lazy stages

- `map`
- `filter`
- `take`
- `skip`
- `unique`
- `flatMap`

These return iterators and therefore do not execute the callback until consumed.

## Terminal / materializing stages

- `reduce` — folds an iterable into one value
- `toArray` — explicitly materializes an iterable
- `count` — counts elements without creating an array
- `first` — returns the first element
- `find` — stops at the first matching element
- `some` — short-circuits on the first match
- `every` — short-circuits on the first failure
- `sort` — materializes because sorting requires random access

## Memory model

A pipeline such as:

```jojo
source |> filter(predicate) |> map(transform) |> take(10)
```

has O(1) pipeline-stage storage (excluding state held by the callbacks and `unique`). It does not allocate an array for the filtered collection or mapped collection.

`unique` stores its seen values, so its memory usage is O(number of distinct values consumed).

`sort` is an explicit materialization boundary and uses O(n) additional storage.

## Backwards compatibility

Normal JavaScript remains unchanged:

```js
const doubled = values.map(x => x * 2)
```

Only JojoScript pipeline stages use the runtime collection functions.

A pipeline that needs an array should terminate with `toArray`:

```jojo
const users = source |> map(normalize) |> toArray
```

This makes allocation visible in the language rather than hiding it in every stage.
