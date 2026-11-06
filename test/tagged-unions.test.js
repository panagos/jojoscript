import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { compile } from '../src/compiler.js'
import { transformTypeDeclarations, findTypeDeclarations } from '../src/type-declarations.js'
import { defineType } from '../src/runtime/tagged-unions.js'
import { defineType as exportedDefineType } from '../src/runtime/index.js'

const RUNTIME = pathToFileURL(path.resolve('src/runtime/index.js')).href

async function evaluate(source) {
  return import(`data:text/javascript,${encodeURIComponent(compile(source, { runtimeImport: RUNTIME }))}`)
}

const RESULT_TYPE = `
export type Result =
  | Ok(value)
  | Failed(message)
`

test('a multi-line type declaration compiles to defineType plus its constructors', () => {
  assert.equal(
    transformTypeDeclarations('type Result =\n  | Ok(value)\n  | Failed(message)\nnext()\n'),
    'const Result = defineType("Result", { Ok: ["value"], Failed: ["message"] }); const { Ok, Failed } = Result\n\n\nnext()\n'
  )
})

test('single-line declarations support exports, several fields, and fieldless variants', () => {
  assert.equal(
    transformTypeDeclarations('export type Shape = Circle(radius) | Rect(width, height) | Empty'),
    'export const Shape = defineType("Shape", { Circle: ["radius"], Rect: ["width", "height"], Empty: [] }); export const { Circle, Rect, Empty } = Shape'
  )
})

test('findTypeDeclarations reports each type with its variants and fields', () => {
  assert.deepEqual(findTypeDeclarations(RESULT_TYPE).map(({ name, variants }) => ({ name, variants })), [
    { name: 'Result', variants: [{ name: 'Ok', fields: ['value'] }, { name: 'Failed', fields: ['message'] }] }
  ])
})

test('compile auto-imports defineType only when a type is declared', () => {
  assert.match(compile(RESULT_TYPE), /^import \{ defineType \} from "@panagos\/jojoscript\/runtime"/)
  assert.doesNotMatch(compile('x := 1\n'), /defineType/)
})

test('ordinary uses of the word type are left untouched', () => {
  const source = 'const type = node.type\ntype = "x"\nlabel := "type Fake = A | B"\n// type Commented = A\n'
  assert.equal(transformTypeDeclarations(source), source)
})

test('invalid type declarations are rejected at compile time', () => {
  assert.throws(() => compile('type Result = ok(value)\n'), /Variant "ok" of type "Result" must start with an uppercase letter/)
  assert.throws(() => compile('type Result = Ok(value) | Ok(other)\n'), /Type "Result" declares variant "Ok" more than once/)
  assert.throws(() => compile('type Pair = Pair(left, left)\n'), /Variant "Pair" declares field "left" more than once/)
})

test('constructors build frozen tagged values and check their arity', () => {
  const Option = defineType('Option', { Some: ['value'], None: [] })

  assert.deepEqual(Option.Some(1), { tag: 'Some', value: 1 })
  assert.deepEqual(Option.None(), { tag: 'None' })
  assert.ok(Object.isFrozen(Option.Some(1)))
  assert.deepEqual(Option.Some.fields, ['value'])
  assert.equal(Option.Some.tag, 'Some')
  assert.equal(Option.Some.type, 'Option')
  assert.throws(() => Option.Some(), { name: 'TypeError', message: 'Some expects 1 argument (value), got 0' })
  assert.throws(() => Option.None(1), { name: 'TypeError', message: 'None expects 0 arguments, got 1' })
  assert.equal(exportedDefineType, defineType)
})

test('a variant field cannot be named tag', () => {
  assert.throws(() => defineType('Bad', { Item: ['tag'] }), /Variant "Item" cannot declare a field named "tag"/)
})

test('constructor patterns match by tag and bind fields by position', async () => {
  const { Ok, Failed, describe } = await evaluate(`${RESULT_TYPE}
export fn describe(result) {
  return match result {
    Ok(v) => \`ok: \${v}\`
    Failed(reason) => \`failed: \${reason}\`
  }
}
`)
  assert.equal(describe(Ok(42)), 'ok: 42')
  assert.equal(describe(Failed('timeout')), 'failed: timeout')
  assert.equal(describe(JSON.parse(JSON.stringify(Ok('from json')))), 'ok: from json')
  assert.throws(() => describe({ tag: 'Pending' }), /No match arm matched the value/)
})

test('constructor pattern arguments can be literals, wildcards, and nested patterns', async () => {
  const { Ok, Failed, classify } = await evaluate(`${RESULT_TYPE}
export fn classify(result) {
  return match result {
    Ok(0) => "zero"
    Ok({ items }) => \`\${items.length} items\`
    Ok(_) => "some value"
    Failed(_) => "failure"
  }
}
`)
  assert.equal(classify(Ok(0)), 'zero')
  assert.equal(classify(Ok({ items: [1, 2] })), '2 items')
  assert.equal(classify(Ok('x')), 'some value')
  assert.equal(classify(Failed('x')), 'failure')
})

test('lowercase call patterns are still compared by value', () => {
  assert.match(compile('x := match y { compute(1) => 1, _ => 0 }'), /if \(__match === \(compute\(1\)\)\) return 1;/)
})
