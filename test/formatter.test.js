import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { formatSource } from '../src/formatter.js'
import { formatSource as exportedFormatSource } from '../src/index.js'

test('blocks are reindented from their nesting depth and trailing whitespace is removed', () => {
  assert.equal(
    formatSource('fn add(a, b) {   \n        return a + b\n}'),
    'fn add(a, b) {\n  return a + b\n}\n'
  )
})

test('pipeline continuations and multi-line declarations get one extra level', () => {
  assert.equal(
    formatSource('result :=\norders\n|> filter(isPaid)    @paid\n|> toArray\n\nnext := 1\n'),
    'result :=\n  orders\n    |> filter(isPaid)    @paid\n    |> toArray\n\nnext := 1\n'
  )
})

test('contract clauses and tagged union variants are indented under their declaration', () => {
  assert.equal(
    formatSource('fn divide(a, b)\nrequires b != 0\n    ensures result * b == a\n{\nreturn a / b\n}\n\ntype Result =\n| Ok(value)\n      | Failed(message)\n'),
    'fn divide(a, b)\n  requires b != 0\n  ensures result * b == a\n{\n  return a / b\n}\n\ntype Result =\n  | Ok(value)\n  | Failed(message)\n'
  )
})

test('named pipeline stages align with their source line, and match arms are indented by their braces', () => {
  assert.equal(
    formatSource('pipeline active {\nsource users\n\n|> filter(isActive)\n}\n\nlabel := match r {\nOk(v) => v\n_ => 0\n}\n'),
    'pipeline active {\n  source users\n\n  |> filter(isActive)\n}\n\nlabel := match r {\n  Ok(v) => v\n  _ => 0\n}\n'
  )
})

test('runs of blank lines collapse and the file ends with one newline', () => {
  assert.equal(formatSource('\n\na := 1\n\n\n\nb := 2\n\n\n'), 'a := 1\n\nb := 2\n')
})

test('block comments and template literal text are left untouched', () => {
  const source = '/*\n   keep   this\n*/\nmessage := `\n   line ${\nvalue\n}\n   end`\n'
  assert.equal(formatSource(source), '/*\n   keep   this\n*/\nmessage := `\n   line ${\n  value\n}\n   end`\n')
})

test('strings containing brackets do not change the indentation', () => {
  assert.equal(formatSource('fn f() {\nlabel := "{ ( ["\nreturn label\n}\n'), 'fn f() {\n  label := "{ ( ["\n  return label\n}\n')
})

test('the indent unit can be changed and Windows line endings are normalized', () => {
  assert.equal(formatSource('fn f() {\r\nreturn 1\r\n}', { indent: '\t' }), 'fn f() {\n\treturn 1\n}\n')
})

test('formatting is idempotent', () => {
  const once = formatSource('fn divide(a, b)\nrequires b != 0\n{\nreturn a |> double\n|> half\n}\n')
  assert.equal(formatSource(once), once)
})

test('every example source is already formatted', () => {
  const files = fs.readdirSync('example/src', { recursive: true }).filter(file => file.endsWith('.jojo'))
  for (const file of files) {
    const source = fs.readFileSync(path.join('example/src', file), 'utf8')
    assert.equal(formatSource(source), source, file)
  }
})

test('the VS Code extension ships an identical copy of the formatter', () => {
  assert.equal(
    fs.readFileSync('editors/vscode/src/formatter.mjs', 'utf8'),
    fs.readFileSync('src/formatter.js', 'utf8')
  )
})

test('formatSource is exported from the compiler entry point', () => {
  assert.equal(exportedFormatSource, formatSource)
})

test('a line that opens several brackets indents its contents only one level', () => {
  assert.equal(
    formatSource('fn group(posts) {\nreturn posts.reduce((groups, post) => {\ngroups[post.id] = post\nreturn groups\n}, {})\n}\n'),
    'fn group(posts) {\n  return posts.reduce((groups, post) => {\n    groups[post.id] = post\n    return groups\n  }, {})\n}\n'
  )
})

test('calls continuing a pipeline stage, ternaries, and method chains are indented under their line', () => {
  assert.equal(
    formatSource('fn f(xs) {\nreturn xs\n|> reduce(\n(a, b) => a + b,\n0\n)\n}\n\nfn pick(a, b) {\nreturn a > b\n? a\n: b\n}\n\nfn load(repo) {\nreturn repo\n.findAll()\n}\n'),
    'fn f(xs) {\n  return xs\n    |> reduce(\n      (a, b) => a + b,\n      0\n    )\n}\n\nfn pick(a, b) {\n  return a > b\n    ? a\n    : b\n}\n\nfn load(repo) {\n  return repo\n    .findAll()\n}\n'
  )
})

test('a braceless arrow body on the next line is indented like a declaration continuation', () => {
  assert.equal(
    formatSource('export const titles = posts =>\nposts\n|> map(post => post.title)\n'),
    'export const titles = posts =>\n  posts\n    |> map(post => post.title)\n'
  )
})
