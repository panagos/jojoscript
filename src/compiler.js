import fs from 'node:fs'
import path from 'node:path'

import {
  transformPipelines,
  findPipelineStdlibFunctions
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

const JOJO_RUNTIME = 'jojoscript/runtime'

export function compile(source) {
  let result = source

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
   * Pipelines.
   */
  result = transformPipelines(result)

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
    result = mergeRuntimeImport(result, pipelineStdlibFunctions)
  }

  return result.endsWith('\n') ? result : result + '\n'
}

const RUNTIME_IMPORT_PATTERN = /import\s*\{([^}]*)\}\s*from\s*(["'])jojoscript\/runtime\2/

function mergeRuntimeImport(source, stdlibFunctions) {
  const existing = source.match(RUNTIME_IMPORT_PATTERN)

  if (!existing) {
    return `import { ${stdlibFunctions.join(', ')} } from "${JOJO_RUNTIME}"\n` + source
  }

  const existingNames = existing[1].split(',').map(name => name.trim()).filter(Boolean)
  const merged = [...new Set([...existingNames, ...stdlibFunctions])]

  return source.replace(
    RUNTIME_IMPORT_PATTERN,
    `import { ${merged.join(', ')} } from "${JOJO_RUNTIME}"`
  )
}

export function compileFile(input, outDir = null) {
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
    compile(fs.readFileSync(src, 'utf8')),
    'utf8'
  )

  return { input: src, output: out }
}

export function compileDirectory(inputDir, outDir = null) {
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
        compile(fs.readFileSync(full, 'utf8')),
        'utf8'
      )

      result.push({ input: full, output: out })
    }
  }

  walk(root)
  return result
}
