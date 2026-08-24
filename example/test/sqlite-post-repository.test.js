import test from "node:test"
import assert from "node:assert/strict"

import { createDatabase, closeAsync } from "../dist/infrastructure/database.js"
import { SqlitePostRepository } from "../dist/infrastructure/sqlite-post-repository.js"
import { createPost } from "../dist/domain/post.js"

test("stores and retrieves posts from sqlite", async () => {
  const db = await createDatabase()
  const repository = new SqlitePostRepository(db)

  await repository.save(
    createPost({
      id: 1,
      userId: 10,
      title: "First",
      body: "Hello"
    })
  )

  await repository.save(
    createPost({
      id: 2,
      userId: 10,
      title: "Second",
      body: "World"
    })
  )

  assert.equal((await repository.findAll()).length, 2)
  assert.equal((await repository.findByUserId(10)).length, 2)
  assert.equal((await repository.findByUserId(99)).length, 0)

  await closeAsync(db)
})
