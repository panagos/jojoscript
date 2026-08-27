import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  CheckpointStore,
  MemoryCheckpointStore,
  FileCheckpointStore
} from '../src/runtime/checkpoint-store.js'

test('the abstract CheckpointStore throws "not implemented" for every method', async () => {
  const store = new CheckpointStore()
  await assert.rejects(() => store.save({}), /not implemented/)
  await assert.rejects(() => store.load('p', 'c'), /not implemented/)
  await assert.rejects(() => store.exists('p', 'c'), /not implemented/)
  await assert.rejects(() => store.delete('p', 'c'), /not implemented/)
})

test('MemoryCheckpointStore: save, load, exists, delete, list', async () => {
  const store = new MemoryCheckpointStore()

  assert.equal(await store.exists('p1', 'c1'), false)

  await store.save({ pipelineId: 'p1', checkpointId: 'c1', items: [1, 2, 3] })
  assert.equal(await store.exists('p1', 'c1'), true)
  assert.deepEqual((await store.load('p1', 'c1')).items, [1, 2, 3])
  assert.deepEqual(store.list('p1'), ['c1'])

  await store.delete('p1', 'c1')
  assert.equal(await store.exists('p1', 'c1'), false)
})

test('MemoryCheckpointStore throws a clear error for a missing checkpoint', async () => {
  const store = new MemoryCheckpointStore()
  await assert.rejects(() => store.load('p1', 'missing'), /Checkpoint not found: missing/)
})

test('MemoryCheckpointStore isolates checkpoints per pipeline id', async () => {
  const store = new MemoryCheckpointStore()
  await store.save({ pipelineId: 'p1', checkpointId: 'c1', items: [1] })
  await store.save({ pipelineId: 'p2', checkpointId: 'c1', items: [2] })
  assert.deepEqual((await store.load('p1', 'c1')).items, [1])
  assert.deepEqual((await store.load('p2', 'c1')).items, [2])
})

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jojo-checkpoint-store-'))
}

test('FileCheckpointStore: save, load, exists, delete, list', async () => {
  const dir = tempDir()
  const store = new FileCheckpointStore(dir)

  assert.equal(await store.exists('p1', 'c1'), false)

  await store.save({ pipelineId: 'p1', checkpointId: 'c1', items: [1, 2, 3], itemCount: 3 })
  assert.equal(await store.exists('p1', 'c1'), true)
  assert.deepEqual((await store.load('p1', 'c1')).items, [1, 2, 3])
  assert.deepEqual(store.list('p1'), ['c1'])

  await store.delete('p1', 'c1')
  assert.equal(await store.exists('p1', 'c1'), false)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('FileCheckpointStore throws a clear error for a missing checkpoint', async () => {
  const dir = tempDir()
  const store = new FileCheckpointStore(dir)
  await assert.rejects(() => store.load('p1', 'missing'), /Checkpoint not found: missing/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('FileCheckpointStore surfaces a clear error for a corrupted checkpoint file', async () => {
  const dir = tempDir()
  const store = new FileCheckpointStore(dir)

  await store.save({ pipelineId: 'p1', checkpointId: 'c1', items: [1] })
  fs.writeFileSync(path.join(dir, 'p1', 'c1.json'), '{ not valid json')

  await assert.rejects(() => store.load('p1', 'c1'), /Corrupted checkpoint "c1"/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('FileCheckpointStore.list returns an empty array for an unknown pipeline', () => {
  const dir = tempDir()
  const store = new FileCheckpointStore(dir)
  assert.deepEqual(store.list('never-seen'), [])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('FileCheckpointStore never leaves a partial file behind on write (atomic rename)', async () => {
  const dir = tempDir()
  const store = new FileCheckpointStore(dir)

  await store.save({ pipelineId: 'p1', checkpointId: 'c1', items: Array.from({ length: 1000 }, (_, i) => i) })

  const files = fs.readdirSync(path.join(dir, 'p1'))
  assert.deepEqual(files, ['c1.json'])
  assert.ok(!files.some(name => name.includes('.tmp-')))

  fs.rmSync(dir, { recursive: true, force: true })
})
