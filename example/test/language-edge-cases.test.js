import test from "node:test"
import assert from "node:assert/strict"

import {
  logTopTags,
  buildTagBuckets,
  buildTagReport,
  summarizeTitles,
  jojoSyntaxSample,
  describeCount,
  loadGreeting
} from "../dist/application/language-edge-cases.js"

const posts = [
  { id: 1, title: "Alpha", tags: ["js", "backend"] },
  { id: 2, title: "Beta", tags: ["backend", "sqlite"] },
  { id: 3, title: "Gamma", tags: ["js", "jojo"] }
]

test("pipeline used as a function call argument logs the expected value", () => {
  const logs = []
  const originalLog = console.log
  console.log = (value) => logs.push(value)

  try {
    logTopTags(posts)
  } finally {
    console.log = originalLog
  }

  assert.deepEqual(logs, [["js", "backend", "sqlite"]])
})

test("pipeline used as an array literal element", () => {
  assert.deepEqual(
    buildTagBuckets(posts, "extra"),
    [["js", "backend", "sqlite", "jojo"], "extra"]
  )
})

test("pipeline used as an object literal property value", () => {
  assert.deepEqual(buildTagReport(posts), {
    total: 3,
    tags: ["js", "backend", "sqlite", "jojo"]
  })
})

test("pipeline as a concise arrow function body", () => {
  assert.deepEqual(summarizeTitles(posts), ["Alpha", "Beta", "Gamma"])
})

test("expression fn with a default parameter that calls a function", () => {
  assert.equal(describeCount(1), "1 items")
  assert.equal(describeCount(3, "posts"), "3 posts")
})

test("jojo syntax embedded in a template literal is left untouched", () => {
  assert.match(jojoSyntaxSample(), /total := 0/)
  assert.match(jojoSyntaxSample(), /mutable count := 0/)
})

test("dynamic import of a local module", async () => {
  assert.equal(await loadGreeting("Jojo"), "Hello, Jojo!")
})
