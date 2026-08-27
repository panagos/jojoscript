import { createHash } from 'node:crypto'

/*
 * A pipeline's identity must be a deterministic hash of its *normalized*
 * structure (stage names + arguments, whitespace-insensitive) rather than a
 * random id, so the same program hashes to the same pipeline id across
 * separate process runs. This is what lets checkpoint data saved by one run
 * be found again by a later run (`jojo resume`, `jojo replay`).
 */
export function computePipelineId(pipeline) {
  const normalized = {
    expression: normalizeText(pipeline.expression),
    stages: pipeline.stages.map(stage => ({
      name: stage.name,
      args: stage.args.map(normalizeText)
    }))
  }

  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .slice(0, 16)
}

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim()
}
