import test from "node:test"
import assert from "node:assert/strict"

import {
  buildCollectionReport
} from "../dist/application/collection-showcase.js"

const posts = [
  {
    id: 1,
    title: "Alpha",
    body: "short post",
    published: true,
    tags: ["javascript", "backend"]
  },
  {
    id: 2,
    title: "Beta",
    body: "This is a considerably longer post with enough words to exercise the runtime. It keeps going well past two hundred characters so that the `some(posts, post => post.body.length > 200)` check in the collection showcase actually has a genuinely long post to find.",
    published: false,
    tags: ["backend", "sqlite"]
  },
  {
    id: 3,
    title: "Gamma",
    body: "another short post",
    published: true,
    tags: ["javascript", "jojo"]
  },
  {
    id: 4,
    title: "Delta",
    body: "fourth post",
    published: true,
    tags: ["jojo"]
  }
]

test("showcases every collection runtime operation", () => {
  const result = buildCollectionReport(posts)

  assert.equal(result.total, 4)
  assert.equal(result.publishedCount, 3)

  assert.deepEqual(
    result.titles,
    ["Alpha", "Beta", "Delta", "Gamma"]
  )

  assert.equal(result.newest.id, 4)
  assert.equal(result.requested.id, 3)

  assert.deepEqual(
    result.topTitles,
    ["Beta", "Delta", "Gamma"]
  )

  assert.deepEqual(
    result.allTags,
    ["backend", "javascript", "jojo", "sqlite"]
  )

  assert.ok(result.wordCount > 0)
  assert.equal(result.hasLongPost, true)
  assert.equal(result.allHaveTitles, true)
})
