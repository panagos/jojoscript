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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jojo-dataflow-cli-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
  return dir
}

const PIPELINE_SOURCE = `
orders := [1, 2, 3, 4, 5, 6]

fn enrichOrder(n) {
  return n * 10
}

result :=
  orders
    |> filter(n => n % 2 == 0)
    |> checkpoint("enriched")
    |> mapAsync(enrichOrder)
    |> toArrayAsync
    |> await

console.log(JSON.stringify(result))
`

test('--help mentions all dataflow subcommands', () => {
  const { stdout, code } = runCli(['--help'])
  assert.equal(code, 0)
  assert.match(stdout, /jojo graph/)
  assert.match(stdout, /jojo profile/)
  assert.match(stdout, /jojo resume/)
  assert.match(stdout, /jojo replay/)
  assert.match(stdout, /jojo test/)
})

test('graph prints a textual SOURCE -> ... -> RESULT diagram', () => {
  const dir = tempProject()
  fs.writeFileSync(path.join(dir, 'p.jojo'), 'orders |> filter(o => o.ok) |> take(5)\n')

  const { stdout, code } = runCli(['graph', path.join(dir, 'p.jojo')])
  assert.equal(code, 0)
  assert.match(stdout, /SOURCE orders/)
  assert.match(stdout, /FILTER/)
  assert.match(stdout, /TAKE 5/)
  assert.match(stdout, /RESULT/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('graph --format dot prints a digraph', () => {
  const dir = tempProject()
  fs.writeFileSync(path.join(dir, 'p.jojo'), 'orders |> filter(o => o.ok) |> take(5)\n')

  const { stdout, code } = runCli(['graph', path.join(dir, 'p.jojo'), '--format', 'dot'])
  assert.equal(code, 0)
  assert.match(stdout, /^digraph pipeline \{/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('graph rejects an unknown --format value', () => {
  const dir = tempProject()
  fs.writeFileSync(path.join(dir, 'p.jojo'), 'orders |> take(5)\n')

  const { stderr, code } = runCli(['graph', path.join(dir, 'p.jojo'), '--format', 'yaml'])
  assert.equal(code, 1)
  assert.match(stderr, /--format must be "text" or "dot"/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('graph reports when a file has no pipelines', () => {
  const dir = tempProject()
  fs.writeFileSync(path.join(dir, 'p.jojo'), 'x := 1\nconsole.log(x)\n')

  const { stdout, code } = runCli(['graph', path.join(dir, 'p.jojo')])
  assert.equal(code, 0)
  assert.match(stdout, /No pipelines found/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('run, then resume, reuses the checkpoint instead of recomputing it', () => {
  const dir = tempProject()
  const file = path.join(dir, 'p.jojo')
  fs.writeFileSync(file, PIPELINE_SOURCE)

  const checkpointDir = path.join(dir, '.checkpoints')
  const env = { ...process.env, JOJO_CHECKPOINT_DIR: checkpointDir }

  const first = runCli(['run', file], { env })
  assert.equal(first.code, 0)
  assert.match(first.stdout, /\[20,40,60\]/)
  assert.ok(fs.existsSync(checkpointDir))

  const resumed = runCli(['resume', file], { env })
  assert.equal(resumed.code, 0)
  assert.match(resumed.stdout, /Resuming pipeline .+: reusing checkpoint\(s\) enriched/)
  assert.match(resumed.stdout, /\[20,40,60\]/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('resume reports no existing checkpoints on a first run', () => {
  const dir = tempProject()
  const file = path.join(dir, 'p.jojo')
  fs.writeFileSync(file, PIPELINE_SOURCE)

  const checkpointDir = path.join(dir, '.checkpoints')
  const env = { ...process.env, JOJO_CHECKPOINT_DIR: checkpointDir }

  const { stdout, code } = runCli(['resume', file], { env })
  assert.equal(code, 0)
  assert.match(stdout, /No existing checkpoints found; running from the start\./)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('replay requires --from', () => {
  const dir = tempProject()
  const file = path.join(dir, 'p.jojo')
  fs.writeFileSync(file, PIPELINE_SOURCE)

  const { stderr, code } = runCli(['replay', file])
  assert.equal(code, 1)
  assert.match(stderr, /jojo replay` requires --from/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('replay --from an existing checkpoint loads it instead of recomputing', () => {
  const dir = tempProject()
  const file = path.join(dir, 'p.jojo')
  fs.writeFileSync(file, PIPELINE_SOURCE)

  const checkpointDir = path.join(dir, '.checkpoints')
  const env = { ...process.env, JOJO_CHECKPOINT_DIR: checkpointDir }

  const first = runCli(['run', file], { env })
  assert.equal(first.code, 0)

  const replayed = runCli(['replay', file, '--from', 'enriched'], { env })
  assert.equal(replayed.code, 0)
  assert.match(replayed.stdout, /Replaying from checkpoint: enriched/)
  assert.match(replayed.stdout, /\[20,40,60\]/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('profile prints a per-node metrics table', () => {
  const dir = tempProject()
  const file = path.join(dir, 'p.jojo')
  fs.writeFileSync(file, `
orders := [1, 2, 3, 4, 5, 6, 7, 8]
result := orders |> filter(n => n % 2 == 0) |> map(n => n * 2) |> toArray
console.log(JSON.stringify(result))
`)

  const { stdout, code } = runCli(['profile', file])
  assert.equal(code, 0)
  assert.match(stdout, /Node\s+Items\s+Duration\s+Throughput/)
  assert.match(stdout, /source/)
  assert.match(stdout, /filter/)
  assert.match(stdout, /map/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('profile surfaces a compiler error as a friendly message', () => {
  const dir = tempProject()
  const file = path.join(dir, 'p.jojo')
  fs.writeFileSync(file, 'x := match y { "a" => 1 }\n')

  const { stderr, code } = runCli(['profile', file])
  assert.equal(code, 1)
  assert.match(stderr, /jojo: .*default `_` arm/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('test compiles the file and reports when no test file is found', () => {
  const dir = tempProject()
  const file = path.join(dir, 'p.jojo')
  fs.writeFileSync(file, 'x := 1\nconsole.log(x)\n')

  const { stdout, code } = runCli(['test', file])
  assert.equal(code, 0)
  assert.match(stdout, /compiled successfully\. No test file found/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('test runs a co-located <name>.test.js file with node --test', () => {
  const dir = tempProject()
  const file = path.join(dir, 'p.jojo')
  fs.writeFileSync(file, 'export fn double(n) = n * 2\n')
  fs.writeFileSync(path.join(dir, 'p.test.js'), `
import test from 'node:test'
import assert from 'node:assert/strict'
import { double } from './dist/p.js'

test('double doubles', () => {
  assert.equal(double(2), 4)
})
`)

  const { stdout, code } = runCli(['test', file])
  assert.equal(code, 0)
  assert.match(stdout, /pass 1/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('test surfaces a compile error as a friendly message', () => {
  const dir = tempProject()
  const file = path.join(dir, 'p.jojo')
  fs.writeFileSync(file, 'x := match y { "a" => 1 }\n')

  const { stderr, code } = runCli(['test', file])
  assert.equal(code, 1)
  assert.match(stderr, /jojo: .*default `_` arm/)

  fs.rmSync(dir, { recursive: true, force: true })
})
