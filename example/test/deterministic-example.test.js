import test from "node:test"
import assert from "node:assert/strict"

import { generateOrders, generateOrdersWithLiveRates } from "../dist/application/deterministic-example.js"
import { deterministic, NondeterministicEffectError } from "jojoscript/runtime"

test("the same seed always generates the same orders", async () => {
  const first = await deterministic(() => generateOrders(3), { seed: 2026, startTime: Date.UTC(2026, 0, 1) })
  const second = await deterministic(() => generateOrders(3), { seed: 2026, startTime: Date.UTC(2026, 0, 1) })

  assert.deepEqual(first, second)
  assert.equal(first.length, 3)
  assert.equal(first[0].createdAt, "2026-01-01T00:00:00.000Z")
  assert.equal(first[1].createdAt, "2026-01-01T00:00:00.001Z")
  assert.ok(first.every(order => order.totalEur === Math.round(order.totalUsd * 0.9 * 100) / 100))
})

test("a different seed generates different orders", async () => {
  const first = await deterministic(() => generateOrders(3), { seed: 1 })
  const second = await deterministic(() => generateOrders(3), { seed: 2 })

  assert.notDeepEqual(first.map(order => order.totalUsd), second.map(order => order.totalUsd))
})

test("deterministic mode rejects an effect handler that is not declared deterministic", async () => {
  await assert.rejects(deterministic(() => generateOrdersWithLiveRates(1)), NondeterministicEffectError)
})
