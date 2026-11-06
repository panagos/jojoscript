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

test('--help mentions the explain subcommand', () => {
  const { stdout } = runCli(['--help'])
  assert.match(stdout, /jojo explain <file.jojo> \[--format text\|json\] \[--pipeline <name>\]/)
})

test('explain prints the structured meaning of each pipeline', () => {
  const dir = tempProject()
  fs.writeFileSync(path.join(dir, 'p.jojo'), PIPELINE_SOURCE)

  const { stdout, code } = runCli(['explain', path.join(dir, 'p.jojo')])
  assert.equal(code, 0)
  assert.match(stdout, /^PIPELINE result\n\nSTAGES\n {2}1 source {7}orders\n/)
  assert.match(stdout, / {2}3 checkpoint {3}enriched\n/)
  assert.match(stdout, /EFFECTS\n {2}none\n/)
  assert.match(stdout, /resumable: true/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('explain separates multiple pipelines with a blank line', () => {
  const dir = tempProject()
  fs.writeFileSync(path.join(dir, 'p.jojo'), 'a := xs |> count\n\nb := ys |> first\n')

  const { stdout, code } = runCli(['explain', path.join(dir, 'p.jojo')])
  assert.equal(code, 0)
  assert.match(stdout, /deterministic: true\n\nPIPELINE b\n/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('explain --format json prints machine-readable explanations', () => {
  const dir = tempProject()
  fs.writeFileSync(path.join(dir, 'p.jojo'), PIPELINE_SOURCE)

  const { stdout, code } = runCli(['explain', path.join(dir, 'p.jojo'), '--format', 'json'])
  const [explanation] = JSON.parse(stdout)
  assert.equal(code, 0)
  assert.equal(explanation.name, 'result')
  assert.deepEqual(explanation.stages.map(stage => stage.type), [
    'source', 'filter', 'checkpoint', 'mapAsync', 'toArrayAsync', 'await'
  ])

  fs.rmSync(dir, { recursive: true, force: true })
})

test('explain rejects an unknown --format value', () => {
  const dir = tempProject()
  fs.writeFileSync(path.join(dir, 'p.jojo'), 'orders |> take(5)\n')

  const { stderr, code } = runCli(['explain', path.join(dir, 'p.jojo'), '--format', 'dot'])
  assert.equal(code, 1)
  assert.match(stderr, /--format must be "text" or "json"/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('explain reports when a file has no pipelines', () => {
  const dir = tempProject()
  fs.writeFileSync(path.join(dir, 'p.jojo'), 'x := 1\n')

  const { stdout, code } = runCli(['explain', path.join(dir, 'p.jojo')])
  assert.equal(code, 0)
  assert.match(stdout, /No pipelines found/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('--help mentions the plan and generate subcommands', () => {
  const { stdout } = runCli(['--help'])
  assert.match(stdout, /jojo plan <file.jojo> \[--format json\] \[--pipeline <name>\]/)
  assert.match(stdout, /jojo generate <plan.json>/)
})

test('plan prints the machine-readable execution plan as JSON', () => {
  const dir = tempProject()
  fs.writeFileSync(path.join(dir, 'p.jojo'), PIPELINE_SOURCE)

  const { stdout, code } = runCli(['plan', path.join(dir, 'p.jojo')])
  const plan = JSON.parse(stdout)
  assert.equal(code, 0)
  assert.equal(plan.version, 1)
  assert.equal(plan.pipelines[0].pipeline, 'result')
  assert.deepEqual(plan.pipelines[0].stages.slice(0, 3), [
    { type: 'source', expression: 'orders' },
    { type: 'filter', expression: 'n => n % 2 == 0' },
    { type: 'checkpoint', name: 'enriched' }
  ])

  fs.rmSync(dir, { recursive: true, force: true })
})

test('plan accepts --format json and --format=json', () => {
  const dir = tempProject()
  fs.writeFileSync(path.join(dir, 'p.jojo'), 'a := xs |> count\n')

  const separate = runCli(['plan', path.join(dir, 'p.jojo'), '--format', 'json'])
  const inline = runCli(['plan', path.join(dir, 'p.jojo'), '--format=json'])
  assert.equal(separate.code, 0)
  assert.equal(inline.stdout, separate.stdout)

  const rejected = runCli(['plan', path.join(dir, 'p.jojo'), '--format=text'])
  assert.equal(rejected.code, 1)
  assert.match(rejected.stderr, /--format must be "json"/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('generate turns a JSON plan into a JojoScript program', () => {
  const dir = tempProject()
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({
    version: 1,
    pipelines: [{
      pipeline: 'paid',
      stages: [
        { type: 'source', expression: 'orders' },
        { type: 'filter', expression: 'order => order.paid' },
        { type: 'parallel', concurrency: 4 }
      ]
    }]
  }))

  const { stdout, code } = runCli(['generate', path.join(dir, 'plan.json')])
  assert.equal(code, 0)
  assert.equal(stdout, 'paid := orders\n  |> filter(order => order.paid)\n  |> parallel(4)\n')

  fs.rmSync(dir, { recursive: true, force: true })
})

test('generate reports invalid JSON and invalid plans as one line', () => {
  const dir = tempProject()
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ "version": ')
  fs.writeFileSync(path.join(dir, 'invalid.json'), JSON.stringify({ version: 1, pipelines: [{ pipeline: 'a', stages: [] }] }))

  const broken = runCli(['generate', path.join(dir, 'broken.json')])
  assert.equal(broken.code, 1)
  assert.match(broken.stderr, /^jojo: Invalid plan JSON: /)

  const invalid = runCli(['generate', path.join(dir, 'invalid.json')])
  assert.equal(invalid.code, 1)
  assert.equal(invalid.stderr, 'jojo: Invalid plan: pipelines[0].stages must be a non-empty array\n')

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

test('graph, explain, and plan can select a single named pipeline with --pipeline', () => {
  const dir = tempProject()
  const file = path.join(dir, 'p.jojo')
  fs.writeFileSync(file, [
    'pipeline activeUsers {',
    '  source users',
    '  |> filter(user => user.active)',
    '}',
    '',
    'pipeline paidOrders {',
    '  source orders',
    '  |> filter(order => order.paid)',
    '  |> take(5)',
    '}',
    ''
  ].join('\n'))

  const graph = runCli(['graph', file, '--pipeline', 'paidOrders'])
  assert.equal(graph.code, 0)
  assert.match(graph.stdout, /^SOURCE orders\n/)
  assert.doesNotMatch(graph.stdout, /users|Pipeline #/)

  const explain = runCli(['explain', file, '--pipeline', 'activeUsers'])
  assert.match(explain.stdout, /^PIPELINE activeUsers\n/)
  assert.doesNotMatch(explain.stdout, /paidOrders/)

  const plan = JSON.parse(runCli(['plan', file, '--pipeline=paidOrders']).stdout)
  assert.deepEqual(plan.pipelines.map(pipeline => pipeline.pipeline), ['paidOrders'])

  const missing = runCli(['explain', file, '--pipeline', 'nope'])
  assert.equal(missing.code, 1)
  assert.match(missing.stderr, /No pipeline named "nope"/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('check prints diagnostics as text or JSON and exits 1 when the program is invalid', () => {
  const dir = tempProject()
  const file = path.join(dir, 'p.jojo')
  fs.writeFileSync(file, 'fn divide(a, b)\n  requires b != 0\n{\n  return a / b\n}\n\nbad := divide(1, 0)\n')

  const text = runCli(['check', file])
  assert.equal(text.code, 1)
  assert.match(text.stdout, /^ERROR E301\nline 7\nCall divide\(1, 0\) violates "requires b != 0"\n/)

  const machine = runCli(['check', file, '--machine'])
  assert.equal(machine.code, 1)
  assert.equal(JSON.parse(machine.stdout).errors[0].code, 'E301')
  assert.equal(runCli(['check', file, '--format', 'json']).stdout, machine.stdout)

  fs.writeFileSync(file, 'ok := 1\n')
  const valid = runCli(['check', file])
  assert.equal(valid.code, 0)
  assert.equal(valid.stdout, 'valid: no problems found\n')

  fs.rmSync(dir, { recursive: true, force: true })
})

test('check validates JSON plans', () => {
  const dir = tempProject()
  const file = path.join(dir, 'plan.json')
  fs.writeFileSync(file, JSON.stringify({ version: 2, pipelines: [] }))

  const { stdout, code } = runCli(['check', file, '--machine'])
  assert.equal(code, 1)
  assert.equal(JSON.parse(stdout).errors[0].message, 'Invalid plan: version must be 1')

  fs.writeFileSync(file, '{ broken')
  const broken = runCli(['check', file])
  assert.equal(broken.code, 1)
  assert.match(broken.stderr, /jojo: Invalid plan JSON: /)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('describe prints the self-describing JSON document, optionally for one pipeline', () => {
  const dir = tempProject()
  const file = path.join(dir, 'p.jojo')
  fs.writeFileSync(file, 'a := xs |> count\n\nb := ys |> first\n')

  const all = JSON.parse(runCli(['describe', file]).stdout)
  assert.equal(all.language, 'jojo')
  assert.deepEqual(all.pipelines.map(pipeline => pipeline.name), ['a', 'b'])

  const one = JSON.parse(runCli(['describe', file, '--pipeline', 'b']).stdout)
  assert.deepEqual(one.pipelines.map(pipeline => pipeline.name), ['b'])

  fs.rmSync(dir, { recursive: true, force: true })
})

test('simulate prints a static simulation for a chosen input size', () => {
  const dir = tempProject()
  const file = path.join(dir, 'p.jojo')
  fs.writeFileSync(file, 'effect save(row)\n\nr := rows |> map(save) |> checkpoint("saved")\n\nother := xs |> count\n')

  const text = runCli(['simulate', file, '--input', '5000', '--pipeline', 'r'])
  assert.equal(text.code, 0)
  assert.match(text.stdout, /^SIMULATION r\n\nINPUT\n {2}5,000 records\n/)
  assert.match(text.stdout, /⚠ stage 2: up to 5,000 calls to effect "save"/)
  assert.doesNotMatch(text.stdout, /SIMULATION other/)

  const [simulation] = JSON.parse(runCli(['simulate', file, '--input=10', '--format', 'json']).stdout)
  assert.equal(simulation.input, 10)
  assert.deepEqual(simulation.effectCalls, { save: 10 })

  const defaults = runCli(['simulate', file])
  assert.match(defaults.stdout, / {2}1,000 records\n/)
  assert.match(defaults.stdout, /\n\nSIMULATION other\n/)

  const invalid = runCli(['simulate', file, '--input', 'many'])
  assert.equal(invalid.code, 1)
  assert.match(invalid.stderr, /--input must be a positive integer/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('why prints plain-language answers as text or JSON', () => {
  const dir = tempProject()
  const file = path.join(dir, 'p.jojo')
  fs.writeFileSync(file, 'a := xs |> sort\n\nb := ys |> count\n')

  const text = runCli(['why', file, '--pipeline', 'a'])
  assert.equal(text.code, 0)
  assert.match(text.stdout, /^WHY a\n\nWhy is this pipeline deterministic\?\n→ /)
  assert.match(text.stdout, /Why is this pipeline not lazy\?\n→ Stage 2 \(sort\) needs the complete input/)
  assert.doesNotMatch(text.stdout, /WHY b/)

  const json = JSON.parse(runCli(['why', file, '--format', 'json']).stdout)
  assert.deepEqual(json.map(why => why.name), ['a', 'b'])

  fs.writeFileSync(file, 'x := 1\n')
  assert.equal(runCli(['why', file]).stdout, 'No pipelines found.\n')

  fs.rmSync(dir, { recursive: true, force: true })
})

test('format rewrites unformatted files in place and --check reports them without writing', () => {
  const dir = tempProject()
  fs.mkdirSync(path.join(dir, 'nested'))
  fs.mkdirSync(path.join(dir, 'node_modules'))
  fs.writeFileSync(path.join(dir, 'a.jojo'), 'fn f() {\nreturn 1\n}\n')
  fs.writeFileSync(path.join(dir, 'nested', 'b.jojo'), 'ok := 1\n')
  fs.writeFileSync(path.join(dir, 'node_modules', 'c.jojo'), 'fn g() {\nreturn 1\n}\n')

  const check = runCli(['format', dir, '--check'])
  assert.equal(check.code, 1)
  assert.equal(check.stdout, `Needs formatting: ${path.join(dir, 'a.jojo')}\n`)
  assert.equal(fs.readFileSync(path.join(dir, 'a.jojo'), 'utf8'), 'fn f() {\nreturn 1\n}\n')

  const write = runCli(['format', dir])
  assert.equal(write.code, 0)
  assert.equal(write.stdout, `Formatted ${path.join(dir, 'a.jojo')}\n`)
  assert.equal(fs.readFileSync(path.join(dir, 'a.jojo'), 'utf8'), 'fn f() {\n  return 1\n}\n')
  assert.equal(fs.readFileSync(path.join(dir, 'node_modules', 'c.jojo'), 'utf8'), 'fn g() {\nreturn 1\n}\n')

  const clean = runCli(['format', path.join(dir, 'a.jojo'), '--check'])
  assert.equal(clean.code, 0)
  assert.equal(clean.stdout, 'All files are formatted.\n')

  fs.rmSync(dir, { recursive: true, force: true })
})

test('parse prints the syntax nodes as JSON and reports invalid syntax as one line', () => {
  const dir = tempProject()
  const file = path.join(dir, 'p.jojo')
  fs.writeFileSync(file, 'effect save(row)\n\nr := rows |> map(save)\n')

  const parsed = JSON.parse(runCli(['parse', file, '--json']).stdout)
  assert.deepEqual(parsed.nodes.map(node => node.kind), ['effect', 'pipeline'])
  assert.equal(runCli(['parse', file]).stdout, runCli(['parse', file, '--json']).stdout)

  fs.writeFileSync(file, 'type T = lower\n')
  const invalid = runCli(['parse', file])
  assert.equal(invalid.code, 1)
  assert.match(invalid.stderr, /jojo: Variant "lower" of type "T" must start with an uppercase letter/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('run --deterministic makes random numbers, time, and effects reproducible', () => {
  const dir = tempProject()
  const file = path.join(dir, 'p.jojo')
  fs.writeFileSync(file, [
    'import { random, now } from "@panagos/jojoscript/runtime"',
    '',
    'console.log(JSON.stringify([random(), random(), now()]))',
    ''
  ].join('\n'))

  const first = runCli(['run', file, '--deterministic', '--seed', '7'])
  const second = runCli(['run', file, '--deterministic', '--seed=7'])
  const otherSeed = runCli(['run', file, '--deterministic', '--seed', '8'])

  assert.equal(first.code, 0)
  const [a, b, time] = JSON.parse(first.stdout.split('\n').at(-2))
  assert.equal(first.stdout, second.stdout)
  assert.notEqual(first.stdout, otherSeed.stdout)
  assert.ok(a !== b && time === 0)

  fs.writeFileSync(file, 'effect save(x)\n\nhandle { save: x => x } {\n  await save(1)\n}\n')
  const strict = runCli(['run', file, '--deterministic'])
  assert.notEqual(strict.code, 0)
  assert.match(strict.stderr, /Effect "save" has no deterministic handler/)

  assertSeedValidation(file)
  fs.rmSync(dir, { recursive: true, force: true })
})

function assertSeedValidation(file) {
  const invalid = runCli(['run', file, '--deterministic', '--seed', 'abc'])
  assert.equal(invalid.code, 1)
  assert.match(invalid.stderr, /--seed must be a non-negative integer/)
}
