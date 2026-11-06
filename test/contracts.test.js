import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { compile } from '../src/compiler.js'
import { findContracts } from '../src/contracts.js'
import { ContractError } from '../src/runtime/errors.js'
import { ContractError as ExportedContractError } from '../src/runtime/index.js'

const RUNTIME = pathToFileURL(path.resolve('src/runtime/index.js')).href

async function evaluate(source) {
  return import(`data:text/javascript,${encodeURIComponent(compile(source, { runtimeImport: RUNTIME }))}`)
}

const DIVIDE = `
export fn divide(a, b)
  requires b != 0
  ensures result * b == a
{
  return a / b
}

export fn brokenDouble(value)
  requires typeof value == "number"
  ensures result == value * 2
{
  return value + 1
}
`

test('a function with satisfied contracts returns its result', async () => {
  const { divide } = await evaluate(DIVIDE)
  assert.equal(divide(10, 2), 5)
})

test('a violated requires clause throws a non-retryable ContractError before the body runs', async () => {
  const { divide } = await evaluate(DIVIDE)

  assert.throws(() => divide(1, 0), error => {
    assert.ok(error instanceof ContractError)
    assert.equal(error.message, 'Contract violated: divide requires b != 0')
    assert.equal(error.functionName, 'divide')
    assert.equal(error.kind, 'requires')
    assert.equal(error.condition, 'b != 0')
    assert.equal(error.retryable, false)
    return true
  })
})

test('a violated ensures clause reports the broken guarantee', async () => {
  const { brokenDouble } = await evaluate(DIVIDE)
  assert.throws(() => brokenDouble(3), { message: 'Contract violated: brokenDouble ensures result == value * 2' })
  assert.throws(() => brokenDouble('3'), { message: 'Contract violated: brokenDouble requires typeof value == "number"' })
})

test('every requires clause is checked in order', async () => {
  const { processUser } = await evaluate(`
export fn processUser(user)
  requires user.id != null
  requires user.email != null
{
  return user.email
}
`)
  assert.equal(processUser({ id: 1, email: 'a@b.c' }), 'a@b.c')
  assert.throws(() => processUser({ email: 'a@b.c' }), /processUser requires user.id != null/)
  assert.throws(() => processUser({ id: 1 }), /processUser requires user.email != null/)
})

test('async functions await their body before checking ensures, and keep arguments', async () => {
  const { loadName } = await evaluate(`
export async fn loadName(id)
  ensures result.length > 0
{
  const name = await Promise.resolve(arguments.length > 1 ? arguments[1] : "user-" + id)
  return name
}
`)
  assert.equal(await loadName(7), 'user-7')
  await assert.rejects(loadName(7, ''), /loadName ensures result.length > 0/)
})

test('contracts combine with type annotations', async () => {
  const source = 'export fn half(value: number): number\n  requires value >= 0\n{\n  return value / 2\n}\n'
  const output = compile(source, { runtimeImport: 'r' })

  assert.match(output, /@param \{number\} value/)
  assert.match(output, /@returns \{number\}/)
  const { half } = await evaluate(source)
  assert.equal(half(4), 2)
  assert.throws(() => half(-1), /half requires value >= 0/)
})

test('contract clauses keep the source line count so later lines do not shift', () => {
  const output = compile('fn half(value)\n  requires value >= 0\n  ensures result <= value\n{\n  return value / 2\n}\nlast := 1\n', { runtimeImport: 'r' })
  const lines = output.split('\n')

  assert.equal(lines.findIndex(line => line.startsWith('const last')) - lines.findIndex(line => line.startsWith('function half')), 6)
})

test('findContracts reports each contract with its parameters, clauses, and lines', () => {
  assert.deepEqual(findContracts(DIVIDE).map(({ name, params, line, requires, ensures }) => ({ name, params, line, requires, ensures })), [
    {
      name: 'divide',
      params: ['a', 'b'],
      line: 2,
      requires: [{ condition: 'b != 0', line: 3 }],
      ensures: [{ condition: 'result * b == a', line: 4 }]
    },
    {
      name: 'brokenDouble',
      params: ['value'],
      line: 9,
      requires: [{ condition: 'typeof value == "number"', line: 10 }],
      ensures: [{ condition: 'result == value * 2', line: 11 }]
    }
  ])
})

test('functions without clauses and other uses of requires are left untouched', () => {
  const source = 'fn plain(a) {\n  const requires = a\n  return requires\n}\n'
  assert.deepEqual(findContracts(source), [])
  assert.doesNotMatch(compile(source), /ContractError/)
})

test('ContractError is exported from the runtime', () => {
  assert.equal(ExportedContractError, ContractError)
})

test('contracts are found and enforced on pure and effectful functions', async () => {
  const source = 'export effectful fn persist(order)\n  requires order.id != null\n{\n  return order\n}\n'

  assert.deepEqual(findContracts(source).map(contract => contract.name), ['persist'])
  const { persist } = await evaluate(source)
  assert.throws(() => persist({}), /persist requires order.id != null/)
})
