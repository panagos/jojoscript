import test from "node:test"
import assert from "node:assert/strict"

import {
  httpStatusLabel,
  classifyPostLength,
  describeUserRole
} from "../dist/application/match-example.js"

test("match maps known statuses to labels", () => {
  assert.equal(httpStatusLabel(200), "OK")
  assert.equal(httpStatusLabel(404), "Not Found")
})

test("match falls through to the default arm for unknown statuses", () => {
  assert.equal(httpStatusLabel(999), "Unhandled status 999")
})

test("match using boolean patterns classifies by length", () => {
  assert.equal(classifyPostLength({ id: 1, body: "a".repeat(250) }).category, "long")
  assert.equal(classifyPostLength({ id: 2, body: "a".repeat(80) }).category, "medium")
  assert.equal(classifyPostLength({ id: 3, body: "short" }).category, "short")
})

test("match describes known and unknown roles", () => {
  assert.equal(describeUserRole("admin"), "Full access")
  assert.equal(describeUserRole("editor"), "Can edit and publish")
  assert.equal(describeUserRole("guest"), "Unknown role")
})
