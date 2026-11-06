import test from "node:test"
import assert from "node:assert/strict"

import { applyDiscount, priceOrders } from "../dist/application/contracts-example.js"
import { ContractError } from "jojoscript/runtime"

test("discounts within the contract are applied", () => {
  assert.equal(applyDiscount(200, 25), 150)
  assert.deepEqual(priceOrders([{ price: 100, discount: 10 }, { price: 50, discount: 0 }]), [90, 50])
})

test("a discount outside the contract is rejected with a structured, non-retryable error", () => {
  assert.throws(() => priceOrders([{ price: 100, discount: 150 }]), error => {
    assert.ok(error instanceof ContractError)
    assert.equal(error.message, "Contract violated: applyDiscount requires percent >= 0 && percent <= 100")
    assert.equal(error.kind, "requires")
    assert.equal(error.retryable, false)
    return true
  })
  assert.throws(() => applyDiscount(-5, 10), /applyDiscount requires price >= 0/)
})
