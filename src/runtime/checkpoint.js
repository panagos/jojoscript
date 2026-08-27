import { getCurrentContext, getDefaultContext } from './execution-context.js'

/*
 * A pipeline checkpoint. `items` flow through unchanged; the operator's job
 * is purely persistence:
 *
 *  - if a completed checkpoint already exists for this (pipelineId, name),
 *    the upstream `items` iterable is never touched at all (it may be an
 *    expensive, not-yet-started generator) — the saved items are yielded
 *    instead. This is the whole resume mechanism: re-running the same
 *    program after a crash just naturally skips completed work.
 *  - otherwise, items are streamed through as usual (never buffered ahead
 *    of the consumer) and also collected so they can be durably saved once
 *    the full checkpoint has completed. A checkpoint is only ever written
 *    after every item has passed through, so a crash mid-checkpoint never
 *    leaves a partial/misleading checkpoint on disk.
 *
 * `meta.checkpointOrder`/`meta.checkpointIndex` are injected by the
 * compiler: the full, statically-known list of checkpoint names in this
 * pipeline, and this call's position within it. They let `replay(--from)`
 * decide whether a *later* checkpoint must be invalidated/recomputed
 * without depending on the runtime order lazy generators happen to be
 * pulled in (nested generators lazily run their upstream checks only once
 * pulled, which can't be relied on for that decision).
 */
export async function* checkpoint(items, name, meta = {}) {
  const ctx = getCurrentContext() ?? getDefaultContext()
  const pipelineId = ctx.pipelineId ?? meta.pipelineId ?? 'default'
  const store = ctx.checkpointStore

  const replayTargetIndex = ctx.replayFrom && meta.checkpointOrder
    ? meta.checkpointOrder.indexOf(ctx.replayFrom)
    : -1

  const isReplayTarget = ctx.replayFrom === name
  const isAfterReplayTarget =
    replayTargetIndex !== -1 &&
    typeof meta.checkpointIndex === 'number' &&
    meta.checkpointIndex > replayTargetIndex

  if (isReplayTarget) {
    if (!(await store.exists(pipelineId, name))) {
      throw new Error(`Cannot replay from checkpoint "${name}": no such checkpoint exists`)
    }
    const saved = await store.load(pipelineId, name)
    for (const item of saved.items) yield item
    return
  }

  if (!isAfterReplayTarget && await store.exists(pipelineId, name)) {
    const saved = await store.load(pipelineId, name)
    for (const item of saved.items) yield item
    return
  }

  const buffer = []
  for await (const item of items) {
    buffer.push(item)
    yield item
  }

  await store.save({
    pipelineId,
    checkpointId: name,
    items: buffer,
    itemCount: buffer.length,
    createdAt: new Date().toISOString()
  })
}
