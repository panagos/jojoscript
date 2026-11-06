import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'

const CLI = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'bin', 'jojo.js')

function runCli(args) {
  try {
    return { stdout: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: 'pipe' }), code: 0 }
  } catch (error) {
    return { stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.status }
  }
}

function withProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jojo-cli-options-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
  fs.writeFileSync(path.join(dir, 'p.jojo'), 'x := 1\n')
  try {
    fn(dir, path.join(dir, 'p.jojo'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function assertFails(args, message) {
  const { stderr, code } = runCli(args)
  assert.equal(code, 1)
  assert.match(stderr, message)
}

test('commands without an input, and unknown commands, fail with one line', () => {
  assertFails(['build'], /`jojo build` requires a file or directory argument/)
  assertFails(['build', '--watch'], /`jojo build` requires a file or directory argument/)
  assertFails(['transpile', 'x.jojo'], /Unknown command: transpile/)
})

test('build, resume, and run reject missing values, unknown options, and unsupported --watch', () => {
  withProject((dir, file) => {
    assertFails(['build', file, '--out'], /--out requires a directory/)
    assertFails(['build', file, '--verbose'], /Unknown option: --verbose/)
    assertFails(['resume', file, '--watch'], /--watch is not supported with `jojo resume`/)
    assertFails(['run', file, '--watch'], /--watch is not supported with `jojo run`/)
    assertFails(['run', dir], /`jojo run` requires a single .jojo file, not a directory/)
    assertFails(['build', path.join(dir, 'missing.jojo')], /Not found: /)
  })
})

test('single-file commands reject directories, missing files, and unknown options', () => {
  withProject((dir, file) => {
    assertFails(['graph', dir], /`jojo graph` requires a single .jojo file, not a directory/)
    assertFails(['explain', path.join(dir, 'missing.jojo')], /Not found: /)
    assertFails(['graph', file, '--verbose'], /Unknown option: --verbose/)
    assertFails(['generate', file, '--verbose'], /Unknown option: --verbose/)
  })
})

test('replay rejects missing --out and --from values and unknown options', () => {
  withProject((dir, file) => {
    assertFails(['replay', file, '--out'], /--out requires a directory/)
    assertFails(['replay', file, '--from'], /--from requires a checkpoint name/)
    assertFails(['replay', file, '--verbose'], /Unknown option: --verbose/)
  })
})

test('build --out compiles into the requested directory', () => {
  withProject((dir, file) => {
    const { stdout, code } = runCli(['build', file, '--out', path.join(dir, 'out')])
    assert.equal(code, 0)
    assert.match(stdout, /Compiled .*p\.jojo -> .*out[\\/]p\.js/)
  })
})

test('profile reports when a program records no pipeline metrics', () => {
  withProject((dir, file) => {
    const { stdout, code } = runCli(['profile', file])
    assert.equal(code, 0)
    assert.match(stdout, /No pipeline metrics were recorded\./)
  })
})

test('build --watch rebuilds when a .jojo file changes and ignores other files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jojo-cli-watch-'))
  fs.writeFileSync(path.join(dir, 'p.jojo'), 'x := 1\n')

  const child = spawn(process.execPath, [CLI, 'build', dir, '--watch'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })

  // Recursive watching starts asynchronously on Linux, so writes repeat until the expected output appears.
  const writeUntil = (pattern, write = () => {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${pattern} in:\n${output}`)), 5000)
    const touch = setInterval(write, 200)
    const check = () => { if (pattern.test(output)) finish() }
    function finish(error) {
      clearTimeout(timer)
      clearInterval(touch)
      child.stdout.off('data', check)
      child.stderr.off('data', check)
      if (error) reject(error)
      else resolve()
    }
    child.stdout.on('data', check)
    child.stderr.on('data', check)
    check()
  })

  try {
    await writeUntil(/Compiled .*p\.jojo/)

    await writeUntil(/jojo: match requires a default `_` arm/, () => {
      fs.writeFileSync(path.join(dir, 'broken.jojo'), 'x := match y { "a" => 1 }\n')
    })
    fs.rmSync(path.join(dir, 'broken.jojo'))

    await writeUntil(/Change detected: p\.jojo, rebuilding\.\.\.\nCompiled /, () => {
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored\n')
      fs.writeFileSync(path.join(dir, 'p.jojo'), 'x := 2\n')
    })
    assert.doesNotMatch(output, /Change detected: notes\.txt/)
    assert.equal(fs.readFileSync(path.join(dir, 'dist', 'p.js'), 'utf8'), 'const x = 2\n')

    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
    child.kill('SIGTERM')
    assert.deepEqual(await exited, { code: 0, signal: null })
  } finally {
    child.kill()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('profile and test report compile errors as one line', () => {
  withProject((dir, file) => {
    fs.writeFileSync(file, 'x := match y { "a" => 1 }\n')
    assertFails(['profile', file], /jojo: match requires a default `_` arm/)
    assertFails(['test', file], /jojo: match requires a default `_` arm/)
  })
})

test('test reports a successful compile when no co-located test file exists', () => {
  withProject((dir, file) => {
    const { stdout, code } = runCli(['test', file])
    assert.equal(code, 0)
    assert.match(stdout, /p\.jojo compiled successfully\. No test file found \(looked for p\.test\.js\)\./)
  })
})

test('replay requires --from', () => {
  withProject((dir, file) => {
    assertFails(['replay', file], /`jojo replay` requires --from <checkpoint>/)
  })
})

test('resume runs from the start when no checkpoints exist yet', () => {
  withProject((dir, file) => {
    fs.writeFileSync(file, 'console.log(["a"] |> count)\n')
    const { stdout, code } = runCli(['resume', file, '--out', path.join(dir, 'out')])
    assert.equal(code, 0)
    assert.match(stdout, /No existing checkpoints found; running from the start\./)
  })
})

test('profile exits with the program exit code when the profiled program fails', () => {
  withProject((dir, file) => {
    fs.writeFileSync(file, 'xs := [1] |> count\nprocess.exit(3)\n')
    const { code } = runCli(['profile', file])
    assert.equal(code, 3)
  })
})

test('graph labels each pipeline when a file has several', () => {
  withProject((dir, file) => {
    fs.writeFileSync(file, 'a := xs |> count\n\nb := ys |> first\n')
    const { stdout, code } = runCli(['graph', file, '--format', 'dot'])
    assert.equal(code, 0)
    assert.match(stdout, /Pipeline #1 \(id: [0-9a-f]{16}\)\ndigraph pipeline/)
    assert.match(stdout, /Pipeline #2 /)
  })
})

test('profile prints per-second throughput for slow pipelines', () => {
  withProject((dir, file) => {
    fs.writeFileSync(file, [
      'fn slow(value) {',
      '  const until = Date.now() + 20',
      '  while (Date.now() < until) {}',
      '  return value',
      '}',
      '',
      'console.log([1, 2, 3] |> map(slow) |> toArray)',
      ''
    ].join('\n'))

    const { stdout, code } = runCli(['profile', file])
    assert.equal(code, 0)
    assert.match(stdout, /^map\s+3\s+\S+\s+\d+\/s$/m)
  })
})

test('short -h and -v flags print usage and the version', () => {
  assert.match(runCli(['-h']).stdout, /Usage:/)
  assert.match(runCli([]).stdout, /Usage:/)
  assert.match(runCli(['-v']).stdout, /^\d+\.\d+\.\d+\n$/)
})

test('test runs a matching test file from a sibling test directory and propagates its failure', () => {
  withProject((dir, file) => {
    fs.mkdirSync(path.join(dir, 'test'))
    fs.writeFileSync(path.join(dir, 'test', 'p.test.js'), [
      "import test from 'node:test'",
      "import assert from 'node:assert/strict'",
      "test('fails on purpose', () => assert.equal(1, 2))",
      ''
    ].join('\n'))

    const { stdout, code } = runCli(['test', file])
    assert.equal(code, 1)
    assert.match(stdout, /not ok 1 - fails on purpose/)
  })
})

test('build compiles a whole directory', () => {
  withProject(dir => {
    const { stdout, code } = runCli(['build', dir])
    assert.equal(code, 0)
    assert.match(stdout, /Compiled .*p\.jojo -> .*dist[\\/]p\.js/)
  })
})

test('--pipeline requires a pipeline name', () => {
  withProject((dir, file) => {
    assertFails(['explain', file, '--pipeline'], /--pipeline requires a pipeline name/)
  })
})
