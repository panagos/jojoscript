import test from 'node:test'
import assert from 'node:assert/strict'

import { compile } from '../src/compiler.js'

/*
 * Compiler-level tests for the runtime-aware pipeline stages: `inspect`,
 * `checkpoint`, `parallel`, `batch`, `retry`. These only check *codegen*
 * (the metadata the compiler injects); the operators' actual runtime
 * behavior is covered by test/checkpoint-operator.test.js,
 * test/retry-operator.test.js, test/parallel-operator.test.js, etc.
 */

test('inspect stage passes the label through and injects node metadata', () => {
  const result = compile('report := orders |> inspect("paid")')
  assert.match(result, /inspect\(orders, "paid", \{"id":"node-1","pipelineId":"[0-9a-f]+","type":"inspect"\}\)/)
})

test('checkpoint stage injects a stable pipeline id and checkpoint ordering metadata', () => {
  const result = compile('report := orders |> checkpoint("enriched")')
  assert.match(
    result,
    /checkpoint\(orders, "enriched", \{"id":"node-1","pipelineId":"[0-9a-f]+","type":"checkpoint","checkpointOrder":\["enriched"\],"checkpointIndex":0\}\)/
  )
})

test('multiple checkpoints in one pipeline get an ordered checkpointOrder list', () => {
  const result = compile('report := orders |> checkpoint("a") |> map(f) |> checkpoint("b")')
  assert.match(result, /"checkpointOrder":\["a","b"\],"checkpointIndex":0/)
  assert.match(result, /"checkpointOrder":\["a","b"\],"checkpointIndex":1/)
})

test('parallel stage carries the concurrency argument plus metadata', () => {
  const result = compile('report := users |> parallel(8) |> map(fetchProfile)')
  assert.match(result, /parallel\(users, 8, \{"id":"node-1","pipelineId":"[0-9a-f]+","type":"parallel"\}\)/)
})

test('batch stage carries the size argument plus metadata', () => {
  const result = compile('report := stream |> batch(100)')
  assert.match(result, /batch\(stream, 100, \{"id":"node-1","pipelineId":"[0-9a-f]+","type":"batch"\}\)/)
})

test('retry(n) shorthand becomes an attempts options object', () => {
  const result = compile('report := items |> map(fetchProfile) |> retry(3)')
  assert.match(result, /map\(items, retry\(fetchProfile, \{ attempts: 3 \}, \{"id":"node-2","pipelineId":"[0-9a-f]+","type":"retry"\}\)\)/)
})

test('retry fuses into the immediately preceding map stage instead of becoming its own call', () => {
  const result = compile('report := items |> map(fetchProfile) |> retry(3)')
  assert.ok(!/^report := retry\(/.test(result))
  assert.match(result, /const report = map\(items, retry\(/)
})

test('retry fuses into tap/mapAsync/filterAsync too', () => {
  const tapResult = compile('report := items |> tap(log) |> retry(2)')
  assert.match(tapResult, /tap\(items, retry\(log, \{ attempts: 2 \}/)

  const mapAsyncResult = compile('report := items |> mapAsync(fetchProfile) |> retry(2)')
  assert.match(mapAsyncResult, /mapAsync\(items, retry\(fetchProfile, \{ attempts: 2 \}/)
})

test('retry with an options object literal is passed through untouched', () => {
  const result = compile('report := items |> map(fetchProfile) |> retry({ attempts: 5, backoff: "exponential" })')
  assert.match(result, /retry\(fetchProfile, \{ attempts: 5, backoff: "exponential" \}, \{/)
})

test('standalone retry (no preceding map-like stage) wraps the whole expression as a thunk', () => {
  const result = compile('report := fetchData() |> retry(3)')
  assert.match(result, /\(await retry\(async \(\) => \(fetchData\(\)\), \{ attempts: 3 \}, \{"id":"node-1"[^}]*\}\)\(\)\)/)
})

test('retry requires an attempt count or an options object', () => {
  assert.throws(
    () => compile('report := items |> map(f) |> retry()'),
    /retry expects an attempt count or an options object/
  )
})

test('retry takes exactly one argument', () => {
  assert.throws(
    () => compile('report := items |> map(f) |> retry(1, 2)'),
    /retry takes exactly one argument/
  )
})

test('all runtime-aware stages are auto-imported from the runtime', () => {
  const result = compile('report := orders |> checkpoint("x") |> inspect("y")')
  assert.match(result, /import \{ checkpoint, inspect \} from "@panagos\/jojoscript\/runtime"/)
})

test('compiling the same pipeline twice yields the same pipeline id', () => {
  const source = 'report := orders |> filter(o => o.ok) |> checkpoint("x")'
  const first = compile(source).match(/"pipelineId":"([0-9a-f]+)"/)[1]
  const second = compile(source).match(/"pipelineId":"([0-9a-f]+)"/)[1]
  assert.equal(first, second)
})

test('profile mode wraps every stage (and the source) in traceNode', () => {
  const result = compile('report := orders |> filter(f) |> map(g) |> take(3)', { profile: true })
  assert.match(result, /import \{ filter, map, take, traceNode \} from "@panagos\/jojoscript\/runtime"/)
  assert.match(result, /traceNode\(orders, \{"id":"node-0","pipelineId":"[0-9a-f]+","type":"source"\}\)/)
  assert.match(result, /"type":"filter"/)
  assert.match(result, /"type":"map"/)
  assert.match(result, /"type":"take"/)
})

test('profile mode is off by default and produces identical output to a normal compile', () => {
  const source = 'report := orders |> filter(f) |> map(g)'
  assert.equal(compile(source), compile(source, {}))
  assert.ok(!compile(source).includes('traceNode'))
})

test('without any runtime-aware stage, existing pipelines compile exactly as before', () => {
  const result = compile('value := items |> map(f) |> take(5)')
  assert.match(result, /const value = take\(map\(items, f\), 5\)/)
})
