import fs from 'node:fs'
import path from 'node:path'

/*
 * Storage interface for recorded effect calls, mirroring
 * `checkpoint-store.js`'s `CheckpointStore`: the record/replay handler
 * wrappers in `effects.js` only ever talk to this interface, never to a
 * filesystem/database directly, so alternative backends can be added later
 * without touching the effect runtime.
 */
export class EffectLog {
  async record(_call) {
    throw new Error('EffectLog.record() is not implemented')
  }

  async replayNext(_name) {
    throw new Error('EffectLog.replayNext() is not implemented')
  }
}

/*
 * In-memory log. `replayNext(name)` returns recorded calls for that effect
 * name in the order they were recorded, one per call — the same effect
 * invoked three times during recording replays its three results in order
 * during replay, regardless of what other effects were interleaved.
 */
export class MemoryEffectLog extends EffectLog {
  constructor(entries = []) {
    super()
    this.entries = [...entries]
    this.cursor = new Map()
  }

  async record(call) {
    this.entries.push(call)
  }

  async replayNext(name) {
    const index = this.cursor.get(name) ?? 0
    const matches = this.entries.filter(entry => entry.name === name)

    if (index >= matches.length) {
      throw new Error(`No recorded call left to replay for effect "${name}"`)
    }

    this.cursor.set(name, index + 1)
    return matches[index]
  }

  toJSON() {
    return this.entries
  }
}

/*
 * JSON-on-disk log, one file for the whole recording. Like
 * `FileCheckpointStore`, writes go to a temp file first and are then
 * renamed into place so a crash mid-write never corrupts the log.
 */
export class FileEffectLog extends EffectLog {
  constructor(file) {
    super()
    this.file = file
    this.entries = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
    this.cursor = new Map()
  }

  async record(call) {
    this.entries.push(call)

    const dir = path.dirname(this.file)
    fs.mkdirSync(dir, { recursive: true })

    const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(this.entries, null, 2))
    fs.renameSync(tmp, this.file)
  }

  async replayNext(name) {
    const index = this.cursor.get(name) ?? 0
    const matches = this.entries.filter(entry => entry.name === name)

    if (index >= matches.length) {
      throw new Error(`No recorded call left to replay for effect "${name}"`)
    }

    this.cursor.set(name, index + 1)
    return matches[index]
  }
}
