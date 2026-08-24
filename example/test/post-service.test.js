import test from "node:test"
import assert from "node:assert/strict"

import { PostService } from "../dist/application/post-service.js"

const posts = [
  { id: 1, userId: 1, title: "A", body: "short" },
  { id: 2, userId: 1, title: "B", body: "x".repeat(150) },
  { id: 3, userId: 2, title: "C", body: "medium" }
]

function repository() {
  return {
    findAll() {
      return posts
    },

    findByUserId(userId) {
      return posts.filter(post => post.userId === userId)
    }
  }
}

test("returns long posts through a Jojo iterator pipeline", async () => {
  const service = new PostService(repository())

  assert.deepEqual(
    await service.getLongPosts(100),
    [posts[1]]
  )
})

test("returns posts for user", async () => {
  const service = new PostService(repository())

  assert.deepEqual(
    await service.getPostsByUser(2),
    [posts[2]]
  )
})
