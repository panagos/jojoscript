import test from 'node:test'
import assert from 'node:assert/strict'
import { compile } from '../src/compiler.js'

async function evaluate(source) {
  return import(`data:text/javascript,${encodeURIComponent(compile(source))}`)
}

const RESULT_SOURCE = `
export fn unwrap(result) {
  return match result {
    { status: "ok", value } => value
    { status: "error", error } => \`failed: \${error}\`
  }
}
`

test('object patterns compare literal fields and bind named fields', async () => {
  const { unwrap } = await evaluate(RESULT_SOURCE)
  assert.equal(unwrap({ status: 'ok', value: 42 }), 42)
  assert.equal(unwrap({ status: 'error', error: 'timeout' }), 'failed: timeout')
})

test('a structural match without a default arm throws when nothing matches', async () => {
  const { unwrap } = await evaluate(RESULT_SOURCE)
  assert.throws(() => unwrap({ status: 'pending' }), {
    name: 'TypeError',
    message: 'No match arm matched the value'
  })
  assert.throws(() => unwrap(null), { name: 'TypeError' })
})

test('a bound field must be present for its arm to match', async () => {
  const { describe } = await evaluate(`
export fn describe(event) {
  return match event {
    { type: "click", target } => \`click on \${target}\`
    _ => "other"
  }
}
`)
  assert.equal(describe({ type: 'click', target: 'button' }), 'click on button')
  assert.equal(describe({ type: 'click' }), 'other')
  assert.equal(describe('click'), 'other')
})

test('object patterns support renamed bindings, nested patterns, and comma-separated arms', async () => {
  const { total } = await evaluate(`
export fn total(order) {
  return match order {
    { kind: "invoice", amount: { currency: "EUR", value: euros } } => euros,
    { kind: "invoice", amount: { value } } => value * 2,
    _ => 0
  }
}
`)
  assert.equal(total({ kind: 'invoice', amount: { currency: 'EUR', value: 10 } }), 10)
  assert.equal(total({ kind: 'invoice', amount: { currency: 'USD', value: 10 } }), 20)
  assert.equal(total({ kind: 'invoice', amount: null }), 0)
  assert.equal(total({ kind: 'refund' }), 0)
})

test('object pattern fields can compare against member expressions and quoted keys', async () => {
  const { label } = await evaluate(`
const Status = { OK: 200 }

export fn label(response) {
  return match response {
    { code: Status.OK, "content-type": "json" } => "json ok"
    { code: -1 } => "offline"
    _ => "other"
  }
}
`)
  assert.equal(label({ code: 200, 'content-type': 'json' }), 'json ok')
  assert.equal(label({ code: -1 }), 'offline')
  assert.equal(label({ code: 200, 'content-type': 'xml' }), 'other')
})

test('newline-separated arms may span lines and contain nested arrow functions', async () => {
  const { handlers } = await evaluate(`
export fn handlers(message) {
  return match message {
    { type: "list", items } =>
      items.map(item => item * 2)
    { type: "one", item } => [item]
  }
}
`)
  assert.deepEqual(handlers({ type: 'list', items: [1, 2] }), [2, 4])
  assert.deepEqual(handlers({ type: 'one', item: 7 }), [7])
})

test('value-equality matches still compile exactly as before and still require a default arm', () => {
  assert.match(compile('x := match s { "ok" => 1, _ => 0 }'), /if \(__match === \("ok"\)\) return 1;/)
  assert.throws(() => compile('x := match s { "ok" => 1 }'), /match requires a default `_` arm/)
})

test('an object pattern with an invalid field is a syntax error', () => {
  assert.throws(
    () => compile('x := match s { { status: } => 1 }'),
    /Invalid match pattern field: status:/
  )
})
