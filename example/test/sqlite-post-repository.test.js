import test from "node:test"
import assert from "node:assert/strict"

import { createDatabase, closeAsync, runAsync, allAsync } from "../dist/infrastructure/database.js"
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

test("saveMany stores every post in one transaction", async () => {
  const db = await createDatabase()
  const repository = new SqlitePostRepository(db)

  await repository.saveMany([
    createPost({ id: 1, userId: 1, title: "One", body: "First" }),
    createPost({ id: 2, userId: 2, title: "Two", body: "Second" })
  ])

  assert.deepEqual((await repository.findAll()).map(post => post.title), ["One", "Two"])
  await closeAsync(db)
})

test("saveMany rolls back every post when one of them fails to save", async () => {
  const db = await createDatabase()
  const repository = new SqlitePostRepository(db)

  await assert.rejects(
    repository.saveMany([
      createPost({ id: 1, userId: 1, title: "One", body: "First" }),
      { id: 2, userId: 2, title: null, body: "Missing title" }
    ]),
    /NOT NULL constraint failed: posts.title/
  )

  assert.deepEqual(await repository.findAll(), [])
  await closeAsync(db)
})

test("database helpers reject failed statements and a second close", async () => {
  const db = await createDatabase()

  await assert.rejects(runAsync(db, "INSERT INTO missing_table VALUES (1)"), /no such table: missing_table/)
  await assert.rejects(allAsync(db, "SELECT * FROM missing_table"), /no such table: missing_table/)

  await closeAsync(db)
  await assert.rejects(closeAsync(db), /Database is closed/)
})
