import test from "node:test"
import assert from "node:assert/strict"

import { Paid, Declined, Pending, settle, chargeAll } from "../dist/application/tagged-unions-example.js"

test("each payment outcome is settled by its own constructor pattern", () => {
  assert.equal(settle(Paid(40)), "paid 40")
  assert.equal(settle(Declined("insufficient funds")), "ask for another card")
  assert.equal(settle(Declined("card expired")), "declined: card expired")
  assert.equal(settle(Pending()), "waiting for the bank")
})

test("outcomes are plain tagged values that survive a JSON round trip", () => {
  const stored = JSON.parse(JSON.stringify(Paid(15)))

  assert.deepEqual(stored, { tag: "Paid", amount: 15 })
  assert.equal(settle(stored), "paid 15")
})

test("a pipeline charges every order and settles each outcome", () => {
  assert.deepEqual(
    chargeAll([
      { total: 30, limit: 100, confirmed: true },
      { total: 300, limit: 100, confirmed: true },
      { total: 10, limit: 100, confirmed: false }
    ]),
    ["paid 30", "ask for another card", "waiting for the bank"]
  )
})

test("constructors reject the wrong number of arguments", () => {
  assert.throws(() => Paid(), /Paid expects 1 argument \(amount\), got 0/)
})
