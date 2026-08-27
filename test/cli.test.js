import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import url from 'node:url'

const CLI = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'bin', 'jojo.js')

function runCli(args, options = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      ...options
    })
    return { stdout, code: 0 }
  } catch (error) {
    return { stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.status }
  }
}

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jojo-cli-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
  return dir
}

test('--version prints the package version', () => {
  const { stdout, code } = runCli(['--version'])
  const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(CLI), '..', 'package.json'), 'utf8'))
  assert.equal(code, 0)
  assert.equal(stdout.trim(), pkg.version)
})

test('--help prints usage', () => {
  const { stdout, code } = runCli(['--help'])
  assert.equal(code, 0)
  assert.match(stdout, /Usage:/)
  assert.match(stdout, /jojo build/)
  assert.match(stdout, /jojo run/)
})

test('no arguments prints usage', () => {
  const { stdout, code } = runCli([])
  assert.equal(code, 0)
  assert.match(stdout, /Usage:/)
})

test('unknown command fails with a friendly message', () => {
  const { stderr, code } = runCli(['frobnicate'])
  assert.equal(code, 1)
  assert.match(stderr, /jojo: Unknown command: frobnicate/)
})

test('unknown flag fails with a friendly message', () => {
  const dir = tempProject()
  fs.writeFileSync(path.join(dir, 'a.jojo'), 'x := 1\n')

  const { stderr, code } = runCli(['build', path.join(dir, 'a.jojo'), '--bogus'])
  assert.equal(code, 1)
  assert.match(stderr, /jojo: Unknown option: --bogus/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('build compiles a single file to dist by default', () => {
  const dir = tempProject()
  fs.writeFileSync(path.join(dir, 'a.jojo'), 'x := 1\n')

  const { stdout, code } = runCli(['build', path.join(dir, 'a.jojo')])
  assert.equal(code, 0)
  assert.match(stdout, /Compiled/)
  assert.ok(fs.existsSync(path.join(dir, 'dist', 'a.js')))

  fs.rmSync(dir, { recursive: true, force: true })
})

test('build reports a missing input with a friendly message', () => {
  const { stderr, code } = runCli(['build', 'this/path/does/not/exist.jojo'])
  assert.equal(code, 1)
  assert.match(stderr, /jojo: Not found:/)
})

test('build surfaces compiler syntax errors as a friendly message', () => {
  const dir = tempProject()
  fs.writeFileSync(path.join(dir, 'bad.jojo'), 'x := match y { "a" => 1 }\n')

  const { stderr, code } = runCli(['build', path.join(dir, 'bad.jojo')])
  assert.equal(code, 1)
  assert.match(stderr, /jojo: .*default `_` arm/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('run compiles and executes a file', () => {
  const dir = tempProject()
  fs.writeFileSync(path.join(dir, 'hello.jojo'), 'name := "Jojo"\nconsole.log(`Hello, ${name}!`)\n')

  const { stdout, code } = runCli(['run', path.join(dir, 'hello.jojo')])
  assert.equal(code, 0)
  assert.match(stdout, /Hello, Jojo!/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('run rejects a directory argument', () => {
  const dir = tempProject()
  const { stderr, code } = runCli(['run', dir])
  assert.equal(code, 1)
  assert.match(stderr, /jojo: `jojo run` requires a single \.jojo file/)
  fs.rmSync(dir, { recursive: true, force: true })
})
