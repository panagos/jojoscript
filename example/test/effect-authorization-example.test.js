import test from "node:test"
import assert from "node:assert/strict"

import { reviewTender } from "../dist/effects/effect-authorization.js"

test("a procurement capability policy permits reads and blocks side-effecting actions", async () => {
  const invitations = []
  const approvals = []

  const result = await reviewTender("tender-1", invitations, approvals)

  assert.deepEqual(result.tender, { id: "tender-1", supplierId: "supplier-1" })
  assert.deepEqual(result.supplier, { id: "supplier-1", name: "Northwind Supplies" })
  assert.deepEqual(result.denied, [
    "Supplier invitations require the invitation capability",
    "Offer approvals require the approval capability"
  ])
  assert.deepEqual(invitations, [])
  assert.deepEqual(approvals, [])
})
