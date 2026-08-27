#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

import { compile, compileFile, compileDirectory } from '../src/compiler.js'
import { analyzePipelines, renderGraphText, renderGraphDot } from '../src/pipeline-ir.js'
import { FileCheckpointStore } from '../src/runtime/checkpoint-store.js'

const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME_IMPORT = pathToFileURL(path.join(PACKAGE_ROOT, 'src/runtime/index.js')).href

function packageVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
  return pkg.version
}

function usage() {
  console.log(`JojoScript CLI v${packageVersion()}

Usage:
  jojo build <file.jojo|directory> [--out <directory>] [--watch]
  jojo run <file.jojo> [--out <directory>]
  jojo graph <file.jojo> [--format text|dot]
  jojo profile <file.jojo>
  jojo resume <file.jojo> [--out <directory>]
  jojo replay <file.jojo> --from <checkpoint> [--out <directory>]
  jojo test <file.jojo>
  jojo --version
  jojo --help

Examples:
  jojo build src
  jojo build src/main.jojo
  jojo build src --out dist
  jojo build src --watch
  jojo run src/main.jojo
  jojo graph orders.jojo
  jojo graph orders.jojo --format dot
  jojo profile orders.jojo
  jojo resume orders.jojo
  jojo replay orders.jojo --from enriched
  jojo test orders.jojo
`)
}

/*
 * All CLI-facing failures (bad arguments, missing files, compiler syntax
 * errors) are surfaced as a single friendly `jojo: <message>` line instead
 * of a raw stack trace.
 */
function fail(message) {
  throw new Error(message)
}

function parseFlags(args, startIndex) {
  let out = null
  let watch = false

  for (let i = startIndex; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--out') {
      const value = args[++i]
      if (!value) fail('--out requires a directory')
      out = path.resolve(value)
      continue
    }

    if (arg === '--watch') {
      watch = true
      continue
    }

    fail(`Unknown option: ${arg}`)
  }

  return { out, watch }
}

function build(input, out) {
  const resolvedInput = path.resolve(input)

  if (!fs.existsSync(resolvedInput)) {
    fail(`Not found: ${resolvedInput}`)
  }

  const isDirectory = fs.statSync(resolvedInput).isDirectory()

  const result = isDirectory
    ? compileDirectory(resolvedInput, out, { runtimeImport: RUNTIME_IMPORT })
    : [compileFile(resolvedInput, out, { runtimeImport: RUNTIME_IMPORT })]

  for (const item of result) {
    console.log(`Compiled ${item.input} -> ${item.output}`)
  }

  return result
}

function watch(input, out) {
  const resolvedInput = path.resolve(input)
  console.log(`Watching ${resolvedInput} for changes (Ctrl+C to stop)...`)

  const rebuild = () => {
    try {
      build(input, out)
    } catch (error) {
      console.error(`jojo: ${error.message}`)
    }
  }

  rebuild()

  fs.watch(resolvedInput, { recursive: true }, (_, filename) => {
    if (filename && !filename.endsWith('.jojo')) return
    console.log(`\nChange detected${filename ? `: ${filename}` : ''}, rebuilding...`)
    rebuild()
  })
}

function run(input, out) {
  const resolvedInput = path.resolve(input)

  if (!fs.existsSync(resolvedInput) || fs.statSync(resolvedInput).isDirectory()) {
    fail('`jojo run` requires a single .jojo file, not a directory')
  }

  const [{ output }] = build(input, out)

  const child = spawn(process.execPath, [output], { stdio: 'inherit' })
  child.on('exit', code => process.exit(code ?? 0))
  child.on('error', error => fail(error.message))
}

function requireSingleFile(command, input) {
  const resolvedInput = path.resolve(input)

  if (!fs.existsSync(resolvedInput)) fail(`Not found: ${resolvedInput}`)
  if (fs.statSync(resolvedInput).isDirectory()) {
    fail(`\`jojo ${command}\` requires a single .jojo file, not a directory`)
  }

  return resolvedInput
}

function graph(input, format) {
  const resolvedInput = requireSingleFile('graph', input)
  const source = fs.readFileSync(resolvedInput, 'utf8')
  const pipelines = analyzePipelines(source)

  if (!pipelines.length) {
    console.log('No pipelines found.')
    return
  }

  pipelines.forEach((pipeline, index) => {
    if (pipelines.length > 1) console.log(`\nPipeline #${index + 1} (id: ${pipeline.id})`)
    console.log(format === 'dot' ? renderGraphDot(pipeline) : renderGraphText(pipeline))
  })
}

function profile(input) {
  const resolvedInput = requireSingleFile('profile', input)
  const source = fs.readFileSync(resolvedInput, 'utf8')

  let compiled
  try {
    compiled = compile(source, { profile: true, runtimeImport: RUNTIME_IMPORT })
  } catch (error) {
    fail(error.message)
  }

  /*
   * Compiled next to the input file (not under the OS temp directory):
   * Node's ESM resolver walks *up* from the compiled file looking for the
   * nearest `package.json` to resolve bare specifiers like the runtime
   * import, and an unrelated/broken `package.json` anywhere above a temp
   * directory would break that resolution.
   */
  const tmpDir = fs.mkdtempSync(path.join(path.dirname(resolvedInput), '.jojo-profile-'))
  const outFile = path.join(tmpDir, path.basename(resolvedInput, path.extname(resolvedInput)) + '.mjs')
  const metricsFile = path.join(tmpDir, 'metrics.json')

  fs.writeFileSync(outFile, compiled, 'utf8')

  const result = spawnSync(process.execPath, [outFile], {
    stdio: 'inherit',
    env: { ...process.env, JOJO_PROFILE_OUT: metricsFile }
  })

  try {
    if (result.error) fail(result.error.message)

    if (!fs.existsSync(metricsFile)) {
      console.log('No pipeline metrics were recorded.')
      return
    }

    printProfileTable(JSON.parse(fs.readFileSync(metricsFile, 'utf8')))
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }

  if (result.status) process.exit(result.status)
}

function printProfileTable(metrics) {
  const rows = metrics.nodes ?? []

  if (!rows.length) {
    console.log('No pipeline metrics were recorded.')
    return
  }

  const columns = [22, 13, 15]
  console.log(
    'Node'.padEnd(columns[0]) +
    'Items'.padEnd(columns[1]) +
    'Duration'.padEnd(columns[2]) +
    'Throughput'
  )
  console.log('-'.repeat(columns.reduce((a, b) => a + b, 0) + 10))

  for (const row of rows) {
    const duration = `${(row.durationMs / 1000).toFixed(1)}s`
    console.log(
      String(row.type).padEnd(columns[0]) +
      String(row.items).padEnd(columns[1]) +
      duration.padEnd(columns[2]) +
      formatThroughput(row.throughput)
    )
  }
}

function formatThroughput(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M/s`
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K/s`
  return `${Math.round(value)}/s`
}

function resume(input, out) {
  const resolvedInput = requireSingleFile('resume', input)
  const source = fs.readFileSync(resolvedInput, 'utf8')
  const pipelines = analyzePipelines(source)
  const checkpointDir = process.env.JOJO_CHECKPOINT_DIR || path.resolve('.jojo-checkpoints')

  let anyFound = false
  for (const pipeline of pipelines) {
    const store = new FileCheckpointStore(checkpointDir)
    const existing = store.list(pipeline.id)
    if (existing.length) {
      anyFound = true
      console.log(`Resuming pipeline ${pipeline.id}: reusing checkpoint(s) ${existing.join(', ')}`)
    }
  }

  if (!anyFound) {
    console.log('No existing checkpoints found; running from the start.')
  }

  run(input, out)
}

function replay(input, out, from) {
  if (!from) fail('`jojo replay` requires --from <checkpoint>')

  console.log(`Replaying from checkpoint: ${from}`)
  process.env.JOJO_REPLAY_FROM = from
  run(input, out)
}

function parseGraphFlags(args, startIndex) {
  let format = 'text'

  for (let i = startIndex; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--format') {
      const value = args[++i]
      if (value !== 'text' && value !== 'dot') fail('--format must be "text" or "dot"')
      format = value
      continue
    }

    fail(`Unknown option: ${arg}`)
  }

  return { format }
}

function parseReplayFlags(args, startIndex) {
  let out = null
  let from = null

  for (let i = startIndex; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--out') {
      const value = args[++i]
      if (!value) fail('--out requires a directory')
      out = path.resolve(value)
      continue
    }

    if (arg === '--from') {
      const value = args[++i]
      if (!value) fail('--from requires a checkpoint name')
      from = value
      continue
    }

    fail(`Unknown option: ${arg}`)
  }

  return { out, from }
}

function testCmd(input) {
  const resolvedInput = requireSingleFile('test', input)

  try {
    compileFile(resolvedInput, null, { runtimeImport: RUNTIME_IMPORT })
  } catch (error) {
    fail(error.message)
  }

  const dir = path.dirname(resolvedInput)
  const base = path.basename(resolvedInput, path.extname(resolvedInput))
  const candidates = [
    path.join(dir, `${base}.test.js`),
    path.join(dir, 'test', `${base}.test.js`)
  ].filter(candidate => fs.existsSync(candidate))

  if (!candidates.length) {
    console.log(`${resolvedInput} compiled successfully. No test file found (looked for ${base}.test.js).`)
    return
  }

  const result = spawnSync(process.execPath, ['--test', ...candidates], {
    encoding: 'utf8',
    env: Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name !== 'NODE_TEST_CONTEXT')
    )
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stdout.write(result.stderr)
  process.exit(result.status ?? 0)
}

const COMMANDS = new Set(['build', 'run', 'graph', 'profile', 'resume', 'replay', 'test'])

function main() {
  const args = process.argv.slice(2)

  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    usage()
    return
  }

  if (args[0] === '--version' || args[0] === '-v') {
    console.log(packageVersion())
    return
  }

  const command = args[0]

  if (!COMMANDS.has(command)) {
    usage()
    fail(`Unknown command: ${command}`)
  }

  if (!args[1] || args[1].startsWith('-')) {
    fail(`\`jojo ${command}\` requires a file or directory argument`)
  }

  const input = args[1]

  if (command === 'graph') {
    const { format } = parseGraphFlags(args, 2)
    graph(input, format)
    return
  }

  if (command === 'profile') {
    profile(input)
    return
  }

  if (command === 'test') {
    testCmd(input)
    return
  }

  if (command === 'replay') {
    const { out, from } = parseReplayFlags(args, 2)
    replay(input, out, from)
    return
  }

  const { out, watch: shouldWatch } = parseFlags(args, 2)

  if (command === 'resume') {
    if (shouldWatch) fail('--watch is not supported with `jojo resume`')
    resume(input, out)
    return
  }

  if (command === 'run') {
    if (shouldWatch) fail('--watch is not supported with `jojo run`, use `jojo build --watch` instead')
    run(input, out)
    return
  }

  if (shouldWatch) {
    watch(input, out)
    return
  }

  build(input, out)
}

try {
  main()
} catch (error) {
  console.error(`jojo: ${error.message}`)
  process.exit(1)
}
