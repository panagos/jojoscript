import test from 'node:test'
import assert from 'node:assert/strict'
import { compile } from '../src/compiler.js'

test('async fn', () => {
  const result = compile('async fn getUsers() { return [] }')
  assert.match(result, /async function getUsers\(\)/)
})

test('expression fn', () => {
  const result = compile('fn double(x) = x * 2')
  assert.match(result, /function double\(x\) \{ return x \* 2; \}/)
})

test('normal JavaScript remains valid', () => {
  const source = 'const x = users.map(user => user.name)'
  assert.equal(compile(source).trim(), source)
})

test('multiline pipeline', () => {
  const result = compile(`
    const result =
      users
        |> filter(active)
        |> map(normalize)
        |> take(10)
  `)

  assert.ok(!result.includes('|>'))
  assert.match(result, /filter\(users,\s*active\)/)
  assert.match(result, /map\(filter\(users,\s*active\),\s*normalize\)/)
})

test('pipeline with block arrow', () => {
  const result = compile(`
    const result =
      users
        |> map(user => {
          console.log(user)
          return {
            id: user.id,
            name: user.name
          }
        })
        |> take(10)
  `)
  assert.ok(!result.includes('|>'))
  assert.ok(result.includes('user => {'))
})

test('pipeline with multiple arguments', () => {
  const result = compile(`
    users
      |> sort(
        (a, b) =>
          a.name.localeCompare(b.name)
      )
      |> take(5)
  `)
  assert.ok(!result.includes('|>'))
  assert.ok(result.includes('sort(users,'))
})

test('pipeline inside function', () => {
  const result = compile(`
    function main() {
      report
        |> printReport
    }
  `)
  assert.ok(!result.includes('|>'))
  assert.ok(result.includes('printReport(report)'))
})

test('pipeline with object literal', () => {
  const result = compile(`
    const result =
      ({ users, posts })
        |> buildReport
        |> debug("report")
  `)
  assert.ok(!result.includes('|>'))
  assert.ok(result.includes('buildReport(({ users, posts }))') || result.includes('buildReport(({ users, posts }))'))
})

test('jojo const', () => {
  const result = compile('seen := new Set()')
  assert.ok(result.includes('const seen = new Set()'))
  assert.ok(!result.includes('const const'))
})

test('mutable', () => {
  const result = compile('mutable counter := 0')
  assert.ok(result.includes('let counter = 0'))
})

test('npm imports stay untouched', () => {
  const result = compile('import axios from "axios"')
  assert.ok(result.includes('from "axios"'))
})

test('local imports get js extension', () => {
  const result = compile('import { users } from "./users"')
  assert.ok(result.includes('from "./users.js"'))
})

test('return pipeline', () => {
  const result = compile(`
    function f() {
      return users
        |> filter(active)
        |> map(normalize)
    }
  `)
  assert.ok(!result.includes('|>'))
  assert.ok(result.includes('return map(filter(users, active), normalize)'))
})

test('await pipeline', () => {
  const result = compile(`
    const result =
      await getUsers()
        |> filter(active)
        |> map(normalize)
  `)
  assert.ok(!result.includes('|>'))
  assert.ok(result.includes('map(filter(await getUsers(), active), normalize)'))
})

test('pipeline does not consume previous statement', () => {
  const result = compile(`
    async function main() {
      const users =
        await getUsers()

      const posts =
        await getPosts()

      users
        |> topUsers
        |> printUsers
    }
  `)
  assert.ok(!result.includes('|>'))
  assert.ok(result.includes('const posts ='))
  assert.ok(result.includes('await getPosts()'))
  assert.ok(result.includes('printUsers(topUsers(users))'))
})

test('pipeline stdlib import is generated', () => {
  const result = compile(`users |> map(normalize) |> take(5)`)
  assert.match(result, /import \{ map, take \} from "@panagos\/jojoscript\/runtime"/)
})

test('custom pipeline stages are not imported', () => {
  const result = compile(`users |> printUsers`)
  assert.ok(!result.includes('jojoscript/runtime'))
})

test('placeholder-like ordinary JavaScript is untouched', () => {
  const result = compile(`const value = items.map(item => item.id)`)
  assert.ok(result.includes('items.map(item => item.id)'))
})

test('export expression function', () => {
  const result = compile('export fn double(x) = x * 2')
  assert.equal(result.trim(), 'export function double(x) { return x * 2; }')
})

test('ordinary declarations remain untouched', () => {
  const source = 'const a = 1\nlet b = 2\nvar c = 3'
  assert.equal(compile(source).trim(), source)
})

test('pipeline stage with dotted function name', () => {
  const result = compile('users |> helpers.normalize')
  assert.equal(result.trim(), 'helpers.normalize(users)')
})
