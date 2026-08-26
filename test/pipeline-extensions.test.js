import test from 'node:test'
import assert from 'node:assert/strict'
import { compile } from '../src/compiler.js'

/*
 * Pipeline extensions: the `_` placeholder argument, and the `catch`,
 * `orElse` and `await` control stages.
 */

test('placeholder argument controls where the piped value lands', () => {
  const result = compile('value := items |> divide(100, _)')
  assert.match(result, /const value = divide\(100, items\)/)
})

test('placeholder as the only argument behaves like a normal stage', () => {
  const result = compile('value := items |> wrap(_)')
  assert.match(result, /const value = wrap\(items\)/)
})

test('without a placeholder the piped value is still the first argument', () => {
  const result = compile('value := items |> take(5)')
  assert.match(result, /const value = take\(items, 5\)/)
})

test('catch stage wraps the pipeline in a try/catch IIFE', () => {
  const result = compile('result := risky() |> catch(handleError)')
  assert.match(result, /try \{ return \(risky\(\)\) \} catch \(__error\) \{ return \(handleError\)\(__error\) \}/)
})

test('catch requires exactly one handler argument', () => {
  assert.throws(
    () => compile('result := risky() |> catch()'),
    /catch.*exactly one handler argument/
  )
})

test('orElse stage returns a fallback value instead of a handler call', () => {
  const result = compile('result := risky() |> orElse(0)')
  assert.match(result, /try \{ return \(risky\(\)\) \} catch \(__error\) \{ return \(0\) \}/)
})

test('orElse requires exactly one fallback argument', () => {
  assert.throws(
    () => compile('result := risky() |> orElse()'),
    /orElse.*exactly one fallback argument/
  )
})

test('await stage wraps the pipeline result in await', () => {
  const result = compile('result := fetchData() |> mapAsync(process) |> toArrayAsync |> await')
  assert.match(result, /const result = \(await \(toArrayAsync\(mapAsync\(fetchData\(\), process\)\)\)\)/)
})

test('await stage does not take arguments', () => {
  assert.throws(
    () => compile('result := fetchData() |> await(5)'),
    /await.*does not take arguments/
  )
})

test('await, catch and orElse are never imported from the runtime', () => {
  const result = compile('result := risky() |> catch(handleError)')
  assert.ok(!result.includes('jojoscript/runtime'))
})

test('catch can be combined with regular stdlib stages', () => {
  const result = compile('result := getUsers() |> map(normalize) |> catch(() => [])')
  assert.match(result, /import \{ map \} from "@panagos\/jojoscript\/runtime"/)
  assert.match(result, /try \{ return \(map\(getUsers\(\), normalize\)\) \}/)
})
