import test from "node:test"
import assert from "node:assert/strict"

import { getUserName, getUserNameUnhandled } from "../dist/effects/basic-effects.js"

test("a handled effect returns the handler's result", async () => {
  const user = await getUserName(1)
  assert.deepEqual(user, { id: 1, name: "User 1" })
})

test("invoking an effect with no handler active throws a descriptive error", async () => {
  await assert.rejects(
    () => getUserNameUnhandled(1),
    error => {
      assert.match(error.message, /Unhandled effect: fetchUser/)
      assert.match(error.message, /No handler registered for effect "fetchUser"/)
      return true
    }
  )
})
