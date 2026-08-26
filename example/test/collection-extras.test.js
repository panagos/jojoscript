import test from "node:test"
import assert from "node:assert/strict"

import {
  groupPostsByUser,
  splitByPublished,
  pageify,
  movingAverages,
  pairTitlesWithIds,
  labelTitlesWithIds,
  runningWordCount,
  postsSortedByTitle,
  uniquePostsByUser,
  loggedPosts
} from "../dist/application/collection-extras.js"

const posts = [
  { id: 1, userId: 1, title: "Beta", body: "one two three", published: true },
  { id: 2, userId: 1, title: "Alpha", body: "four five", published: false },
  { id: 3, userId: 2, title: "Gamma", body: "six", published: true }
]

test("groupBy groups posts by user id", () => {
  const groups = groupPostsByUser(posts)
  assert.deepEqual(groups.get(1).map(post => post.id), [1, 2])
  assert.deepEqual(groups.get(2).map(post => post.id), [3])
})

test("partition splits posts by published status", () => {
  const [published, drafts] = splitByPublished(posts)
  assert.deepEqual(published.map(post => post.id), [1, 3])
  assert.deepEqual(drafts.map(post => post.id), [2])
})

test("chunk pages posts into fixed-size groups", () => {
  assert.deepEqual(
    pageify(posts, 2).map(page => page.map(post => post.id)),
    [[1, 2], [3]]
  )
})

test("window computes moving averages", () => {
  assert.deepEqual(movingAverages([1, 2, 3, 4], 2), [1.5, 2.5, 3.5])
})

test("zip pairs ids with titles", () => {
  assert.deepEqual(pairTitlesWithIds(posts), [
    [1, "Beta"],
    [2, "Alpha"],
    [3, "Gamma"]
  ])
})

test("zipWith combines ids with titles using an arity-2 function", () => {
  assert.deepEqual(labelTitlesWithIds(posts), [
    "1: Beta",
    "2: Alpha",
    "3: Gamma"
  ])
})

test("scan produces a running word count", () => {
  assert.deepEqual(runningWordCount(posts), [3, 5, 6])
})

test("sortBy sorts posts by title", () => {
  assert.deepEqual(postsSortedByTitle(posts).map(post => post.title), ["Alpha", "Beta", "Gamma"])
})

test("distinctBy keeps only the first post per user", () => {
  assert.deepEqual(uniquePostsByUser(posts).map(post => post.id), [1, 3])
})

test("tap observes each post while passing it through unchanged", () => {
  const seen = []
  const result = loggedPosts(posts, id => seen.push(id))
  assert.deepEqual(seen, [1, 2, 3])
  assert.deepEqual(result.map(post => post.id), [1, 2, 3])
})
