import fs from 'node:fs'
import path from 'node:path'

/*
 * Storage interface for checkpoints. Deliberately storage-agnostic: the
 * `checkpoint()` runtime operator only ever talks to this interface, never
 * to a filesystem or database directly, so new backends (S3, a database,
 * ...) can be added later without touching pipeline code.
 */
export class CheckpointStore {
  async save(_checkpoint) {
    throw new Error('CheckpointStore.save() is not implemented')
  }

  async load(_pipelineId, _checkpointId) {
    throw new Error('CheckpointStore.load() is not implemented')
  }

  async exists(_pipelineId, _checkpointId) {
    throw new Error('CheckpointStore.exists() is not implemented')
  }

  async delete(_pipelineId, _checkpointId) {
    throw new Error('CheckpointStore.delete() is not implemented')
  }
}

function key(pipelineId, checkpointId) {
  return `${pipelineId}::${checkpointId}`
}

/*
 * In-memory store. Useful for tests and for short-lived processes where
 * durability across restarts is not required.
 */
export class MemoryCheckpointStore extends CheckpointStore {
  constructor() {
    super()
    this.data = new Map()
  }

  async save(checkpoint) {
    this.data.set(key(checkpoint.pipelineId, checkpoint.checkpointId), checkpoint)
  }

  async load(pipelineId, checkpointId) {
    const found = this.data.get(key(pipelineId, checkpointId))
    if (!found) throw new Error(`Checkpoint not found: ${checkpointId}`)
    return found
  }

  async exists(pipelineId, checkpointId) {
    return this.data.has(key(pipelineId, checkpointId))
  }

  async delete(pipelineId, checkpointId) {
    this.data.delete(key(pipelineId, checkpointId))
  }

  list(pipelineId) {
    return [...this.data.values()]
      .filter(checkpoint => checkpoint.pipelineId === pipelineId)
      .map(checkpoint => checkpoint.checkpointId)
  }
}

/*
 * JSON-on-disk store, one file per (pipelineId, checkpointId). Writes go to
 * a temp file first and are then renamed into place, so a crash mid-write
 * can never leave a corrupted checkpoint file behind that would silently
 * poison a later resume.
 */
export class FileCheckpointStore extends CheckpointStore {
  constructor(baseDir = '.jojo-checkpoints') {
    super()
    this.baseDir = baseDir
  }

  filePath(pipelineId, checkpointId) {
    return path.join(this.baseDir, pipelineId, `${checkpointId}.json`)
  }

  async save(checkpoint) {
    const file = this.filePath(checkpoint.pipelineId, checkpoint.checkpointId)
    fs.mkdirSync(path.dirname(file), { recursive: true })

    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(checkpoint), 'utf8')
    fs.renameSync(tmp, file)
  }

  async load(pipelineId, checkpointId) {
    const file = this.filePath(pipelineId, checkpointId)
    if (!fs.existsSync(file)) throw new Error(`Checkpoint not found: ${checkpointId}`)

    let raw
    try {
      raw = fs.readFileSync(file, 'utf8')
      return JSON.parse(raw)
    } catch (error) {
      throw new Error(`Corrupted checkpoint "${checkpointId}": ${error.message}`)
    }
  }

  async exists(pipelineId, checkpointId) {
    return fs.existsSync(this.filePath(pipelineId, checkpointId))
  }

  async delete(pipelineId, checkpointId) {
    const file = this.filePath(pipelineId, checkpointId)
    if (fs.existsSync(file)) fs.unlinkSync(file)
  }

  list(pipelineId) {
    const dir = path.join(this.baseDir, pipelineId)
    if (!fs.existsSync(dir)) return []

    return fs.readdirSync(dir)
      .filter(name => name.endsWith('.json'))
      .map(name => name.slice(0, -'.json'.length))
  }
}
