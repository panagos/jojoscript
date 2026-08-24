#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import { compileFile, compileDirectory } from '../src/compiler.js'

const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function packageVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
  return pkg.version
}

function usage() {
  console.log(`JojoScript CLI v${packageVersion()}

Usage:
  jojo build <file.jojo|directory> [--out <directory>] [--watch]
  jojo run <file.jojo> [--out <directory>]
  jojo --version
  jojo --help

Examples:
  jojo build src
  jojo build src/main.jojo
  jojo build src --out dist
  jojo build src --watch
  jojo run src/main.jojo
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
    ? compileDirectory(resolvedInput, out)
    : [compileFile(resolvedInput, out)]

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

  if (command !== 'build' && command !== 'run') {
    usage()
    fail(`Unknown command: ${command}`)
  }

  if (!args[1] || args[1].startsWith('-')) {
    fail(`\`jojo ${command}\` requires a file or directory argument`)
  }

  const input = args[1]
  const { out, watch: shouldWatch } = parseFlags(args, 2)

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
