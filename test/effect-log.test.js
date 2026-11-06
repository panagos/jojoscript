import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { defineEffect, withHandlers, recordHandlers, replayHandlers } from '../src/runtime/effects.js'
import { EffectLog, MemoryEffectLog, FileEffectLog } from '../src/runtime/effect-log.js'

test('recordHandlers runs the real handler and appends each call to the log', async () => {
  const fetchUser = defineEffect('fetchUser__record', ['id'])
  const log = new MemoryEffectLog()

  const result = await withHandlers(
    recordHandlers({ fetchUser__record: id => ({ id, name: `user-${id}` }) }, log),
    async () => [await fetchUser(1), await fetchUser(2)]
  )

  assert.deepEqual(result, [{ id: 1, name: 'user-1' }, { id: 2, name: 'user-2' }])
  assert.equal(log.entries.length, 2)
  assert.equal(log.entries[0].name, 'fetchUser__record')
  assert.deepEqual(log.entries[0].args, [1])
  assert.deepEqual(log.entries[0].result, { id: 1, name: 'user-1' })
})

test('replayHandlers replays recorded results without invoking any real code', async () => {
  const fetchUser = defineEffect('fetchUser__replay', ['id'])
  const log = new MemoryEffectLog()
  let realCalls = 0

  await withHandlers(
    recordHandlers({ fetchUser__replay: id => { realCalls++; return { id, name: `user-${id}` } } }, log),
    async () => [await fetchUser(1), await fetchUser(2)]
  )

  assert.equal(realCalls, 2)

  const replayed = await withHandlers(
    replayHandlers(['fetchUser__replay'], log),
    async () => [await fetchUser(1), await fetchUser(2)]
  )

  assert.equal(realCalls, 2, 'replay must not invoke the real handler again')
  assert.deepEqual(replayed, [{ id: 1, name: 'user-1' }, { id: 2, name: 'user-2' }])
})

test('replaying more calls than were recorded for an effect throws a clear error', async () => {
  const fetchUser = defineEffect('fetchUser__replay-exhausted', ['id'])
  const log = new MemoryEffectLog()

  await withHandlers(
    recordHandlers({ 'fetchUser__replay-exhausted': id => ({ id }) }, log),
    () => fetchUser(1)
  )

  await assert.rejects(
    () => withHandlers(
      replayHandlers(['fetchUser__replay-exhausted'], log),
      async () => { await fetchUser(1); return fetchUser(2) }
    ),
    /No recorded call left to replay for effect "fetchUser__replay-exhausted"/
  )
})

test('replay handlers are marked deterministic', async () => {
  const log = new MemoryEffectLog()
  const handlers = replayHandlers(['fetchUser__deterministic-flag'], log)
  assert.equal(handlers['fetchUser__deterministic-flag'].deterministic, true)
})

test('FileEffectLog persists recordings across instances and replays them back', async () => {
  const fetchUser = defineEffect('fetchUser__file-log', ['id'])
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jojo-effect-log-')), 'log.json')

  const writer = new FileEffectLog(file)
  await withHandlers(
    recordHandlers({ 'fetchUser__file-log': id => ({ id, name: `user-${id}` }) }, writer),
    () => fetchUser(1)
  )

  assert.ok(fs.existsSync(file))

  const reader = new FileEffectLog(file)
  const replayed = await withHandlers(
    replayHandlers(['fetchUser__file-log'], reader),
    () => fetchUser(1)
  )

  assert.deepEqual(replayed, { id: 1, name: 'user-1' })
})

test('the abstract EffectLog reports its methods as not implemented', async () => {
  const log = new EffectLog()
  await assert.rejects(() => log.record({}), /EffectLog.record\(\) is not implemented/)
  await assert.rejects(() => log.replayNext('x'), /EffectLog.replayNext\(\) is not implemented/)
})

test('MemoryEffectLog serializes to its recorded entries', async () => {
  const log = new MemoryEffectLog()
  await log.record({ name: 'fetchUser', args: [1], result: 'Ada' })
  assert.deepEqual(JSON.parse(JSON.stringify(log)), [{ name: 'fetchUser', args: [1], result: 'Ada' }])
})

test('FileEffectLog reports when no recorded call is left to replay', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jojo-effect-log-')), 'nested', 'log.json')
  const log = new FileEffectLog(file)
  await log.record({ name: 'fetchUser', args: [1], result: 'Ada' })

  assert.deepEqual(await log.replayNext('fetchUser'), { name: 'fetchUser', args: [1], result: 'Ada' })
  await assert.rejects(() => log.replayNext('fetchUser'), /No recorded call left to replay for effect "fetchUser"/)
})
