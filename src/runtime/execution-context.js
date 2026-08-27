import fs from 'node:fs'
import { AsyncLocalStorage } from 'node:async_hooks'

import { Metrics } from './metrics.js'
import { FileCheckpointStore } from './checkpoint-store.js'

const storage = new AsyncLocalStorage()

/*
 * Everything a running pipeline needs that isn't the data itself: identity,
 * timing, metrics, where to persist checkpoints, and CLI-provided options
 * such as which checkpoint to replay from. Threaded through explicitly via
 * `runInContext`/`getCurrentContext` (AsyncLocalStorage) instead of bare
 * module-level globals.
 */
export class ExecutionContext {
  constructor(options = {}) {
    this.pipelineId = options.pipelineId ?? null
    this.executionId = options.executionId ?? randomId()
    this.startedAt = options.startedAt ?? new Date().toISOString()
    this.currentNode = null
    this.metrics = options.metrics ?? new Metrics()
    this.checkpointStore = options.checkpointStore ?? new FileCheckpointStore()
    this.options = options.options ?? {}
    this.replayFrom = options.replayFrom ?? null
    this.quiet = options.quiet ?? false
  }
}

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function runInContext(context, fn) {
  return storage.run(context, fn)
}

export function getCurrentContext() {
  return storage.getStore()
}

/*
 * Compiled pipelines call `checkpoint()`/`inspect()` as ordinary function
 * calls, with no CLI wrapping required (`node compiled.js` must work on its
 * own for the resume story to make sense). When no context has been set up
 * via `runInContext`, a single lazily-created default context is used
 * instead, configured from environment variables so the CLI can steer it
 * (`jojo replay --from`, `--out`, profiling) without needing to run the
 * compiled module in-process.
 */
let defaultContext = null

export function getDefaultContext() {
  const active = getCurrentContext()
  if (active) return active

  if (!defaultContext) {
    defaultContext = new ExecutionContext({
      checkpointStore: new FileCheckpointStore(process.env.JOJO_CHECKPOINT_DIR || '.jojo-checkpoints'),
      replayFrom: process.env.JOJO_REPLAY_FROM || null,
      quiet: process.env.JOJO_QUIET === '1'
    })

    if (process.env.JOJO_PROFILE_OUT) {
      const outFile = process.env.JOJO_PROFILE_OUT
      process.on('exit', () => {
        try {
          fs.writeFileSync(outFile, JSON.stringify(defaultContext.metrics.toJSON()))
        } catch {
          /* best-effort; a missing metrics file is handled by the CLI */
        }
      })
    }
  }

  return defaultContext
}

/*
 * Test-only escape hatch: forces the next `getDefaultContext()` call in
 * this process to create a fresh default context instead of reusing a
 * memoized one.
 */
export function resetDefaultContext() {
  defaultContext = null
}
