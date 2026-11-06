import test from "node:test"
import assert from "node:assert/strict"

import {
  createPost,
  isLongPost
} from "../dist/domain/post.js"

test("creates a valid post", () => {
  const post = createPost({
    id: 1,
    userId: 2,
    title: " Hello ",
    body: " World "
  })

  assert.deepEqual(post, {
    id: 1,
    userId: 2,
    title: "Hello",
    body: "World"
  })
})

test("rejects invalid post", () => {
  assert.throws(
    () => createPost({
      id: 0,
      userId: 1,
      title: "Title",
      body: "Body"
    }),
    /id must be a positive integer/
  )
})

test("detects long posts", () => {
  const post = createPost({
    id: 1,
    userId: 1,
    title: "Title",
    body: "a".repeat(120)
  })

  assert.equal(isLongPost(post), true)
  assert.equal(isLongPost(post, 121), false)
})

test("rejects posts without a valid user id, title, or body", () => {
  const valid = { id: 1, userId: 1, title: "Title", body: "Body" }

  assert.throws(() => createPost({ ...valid, userId: -1 }), /userId must be a positive integer/)
  assert.throws(() => createPost({ ...valid, title: "  " }), /title is required/)
  assert.throws(() => createPost({ ...valid, body: undefined }), /body is required/)
})
