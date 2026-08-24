import test from "node:test"
import assert from "node:assert/strict"

import {
  loadUserNames,
  loadActiveUsers
} from "../dist/application/async-pipeline-example.js"

function repository(users) {
  return {
    findById: async (id) => users.find(user => user.id === id)
  }
}

const users = [
  { id: 1, name: "Ada", active: true },
  { id: 2, name: "Grace", active: false },
  { id: 3, name: "Alan", active: true }
]

test("mapAsync pipeline stages resolve names for each id", async () => {
  const names = await loadUserNames([1, 2, 3], repository(users))
  assert.deepEqual(names, ["Ada", "Grace", "Alan"])
})

test("mapAsync + filterAsync pipeline keeps only active users", async () => {
  const active = await loadActiveUsers([1, 2, 3], repository(users))
  assert.deepEqual(active.map(user => user.name), ["Ada", "Alan"])
})
