import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  transformPipelines,
  findPipelineStdlibFunctions,
  hasPipelines
} from './pipeline-parser.js'

import {
  transformMutableDeclarations,
  transformConstDeclarations,
  transformMultiBindingDeclarations,
  transformDestructuringDeclarations,
  transformFunctionDeclarations,
  transformExpressionFunctions,
  transformLocalImports
} from './transforms.js'

import { transformMatchExpressions } from './match-parser.js'
import { transformTypeAnnotations } from './type-annotations.js'

/*
 * The auto-generated runtime import must use whatever name this package is
 * actually installed under (e.g. a scoped fork like "@me/jojoscript"), not a
 * hardcoded literal, so it's derived from this package's own package.json
 * instead of being hardcoded.
 */
const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OWN_PACKAGE_NAME = JSON.parse(
  fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')
).name
const JOJO_RUNTIME = `${OWN_PACKAGE_NAME}/runtime`

export function compile(source, options = {}) {
  let result = source
  const runtimeImport = options.runtimeImport ?? JOJO_RUNTIME

  /*
   * Optional type annotations, stripped and re-expressed as JSDoc before
   * anything else touches `fn` declarations.
   */
  result = transformTypeAnnotations(result)

  /*
   * Jojo functions.
   */
  result = transformExpressionFunctions(result)
  result = transformFunctionDeclarations(result)

  /*
   * `match` expressions.
   */
  result = transformMatchExpressions(result)

  /*
   * Jojo declarations.
   */
  result = transformMultiBindingDeclarations(result)
  result = transformDestructuringDeclarations(result)
  result = transformMutableDeclarations(result)
  result = transformConstDeclarations(result)

  /*
   * Remember which pipeline stages need the Jojo runtime before
   * the pipeline syntax itself is removed.
   */
  const pipelineStdlibFunctions =
    findPipelineStdlibFunctions(result)

  /*
   * `jojo profile` compiles with `{ profile: true }`, which wraps every
   * pipeline stage (and the initial source expression) in a call to the
   * `traceNode` runtime helper. That helper is never written by the user,
   * so it must be added to the auto-import list explicitly.
   */
  if (options.profile && hasPipelines(result) && !pipelineStdlibFunctions.includes('traceNode')) {
    pipelineStdlibFunctions.push('traceNode')
  }

  /*
   * Pipelines.
   */
  result = transformPipelines(result, options)

  /*
   * ES module imports.
   */
  result = transformLocalImports(result)

  /*
   * Generated JavaScript imports the runtime as a normal package.
   * This makes compiled applications portable and avoids globals. If the
   * source already has a manual `jojoscript/runtime` import (e.g. for a
   * stdlib function that is only ever called directly, never through a
   * pipeline stage), the auto-imported names are merged into it instead
   * of creating a second, colliding import declaration.
   */
  if (pipelineStdlibFunctions.length) {
    result = mergeRuntimeImport(result, pipelineStdlibFunctions, runtimeImport)
  }

  return result.endsWith('\n') ? result : result + '\n'
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mergeRuntimeImport(source, stdlibFunctions, runtimeImport) {
  const pattern = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*(["'])([^"']+\\/runtime)\\2`
  )
  const existing = source.match(pattern)

  if (!existing) {
    return `import { ${stdlibFunctions.join(', ')} } from "${runtimeImport}"\n` + source
  }

  const existingNames = existing[1].split(',').map(name => name.trim()).filter(Boolean)
  const merged = [...new Set([...existingNames, ...stdlibFunctions])]

  return source.replace(
    pattern,
    `import { ${merged.join(', ')} } from "${runtimeImport}"`
  )
}

export function compileFile(input, outDir = null, options = {}) {
  const src = path.resolve(input)
  const dir = outDir
    ? path.resolve(outDir)
    : path.join(path.dirname(src), 'dist')

  fs.mkdirSync(dir, { recursive: true })

  const out = path.join(
    dir,
    path.basename(src, path.extname(src)) + '.js'
  )

  fs.writeFileSync(
    out,
    compile(fs.readFileSync(src, 'utf8'), options),
    'utf8'
  )

  return { input: src, output: out }
}

export function compileDirectory(inputDir, outDir = null, options = {}) {
  const root = path.resolve(inputDir)
  const target = outDir
    ? path.resolve(outDir)
    : path.join(root, 'dist')

  const result = []

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name.startsWith('.')
      ) {
        continue
      }

      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        walk(full)
        continue
      }

      if (!entry.name.endsWith('.jojo')) continue

      const rel =
        path.relative(root, full).slice(0, -'.jojo'.length) + '.js'

      const out = path.join(target, rel)

      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(
        out,
        compile(fs.readFileSync(full, 'utf8'), options),
        'utf8'
      )

      result.push({ input: full, output: out })
    }
  }

  walk(root)
  return result
}
