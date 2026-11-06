import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"

import { HttpPostSource } from "../dist/infrastructure/http-post-source.js"
import { seedPosts } from "../dist/infrastructure/seed.js"
import { createDatabase, closeAsync } from "../dist/infrastructure/database.js"
import { SqlitePostRepository } from "../dist/infrastructure/sqlite-post-repository.js"

async function withPostsServer(status, body, fn) {
  const server = createServer((request, response) => {
    response.writeHead(status, { "content-type": "application/json" })
    response.end(JSON.stringify(body))
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))

  try {
    await fn(`http://127.0.0.1:${server.address().port}/posts`)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

const apiPosts = [
  { id: 1, userId: 7, title: " First ", body: " Hello " },
  { id: 2, userId: 8, title: "Second", body: "World" }
]

test("HttpPostSource fetches posts and normalizes them into domain posts", async () => {
  await withPostsServer(200, apiPosts, async url => {
    assert.deepEqual(await new HttpPostSource(url).fetchPosts(), [
      { id: 1, userId: 7, title: "First", body: "Hello" },
      { id: 2, userId: 8, title: "Second", body: "World" }
    ])
  })
})

test("HttpPostSource reports a failed HTTP response", async () => {
  await withPostsServer(503, { error: "unavailable" }, async url => {
    await assert.rejects(new HttpPostSource(url).fetchPosts(), /Failed to fetch posts: 503/)
  })
})

test("seedPosts stores fetched posts in the repository", async () => {
  const db = await createDatabase()
  const repository = new SqlitePostRepository(db)

  await withPostsServer(200, apiPosts, url => seedPosts(new HttpPostSource(url), repository))

  assert.deepEqual((await repository.findAll()).map(post => post.title), ["First", "Second"])
  await closeAsync(db)
})
