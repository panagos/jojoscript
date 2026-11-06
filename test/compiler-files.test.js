import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { compile, compileFile, compileDirectory } from '../src/compiler.js'

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jojo-compiler-'))
}

test('compileFile writes the compiled module into a sibling dist directory by default', () => {
  const dir = tempDir()
  const input = path.join(dir, 'app.jojo')
  fs.writeFileSync(input, 'answer := 42\n')

  const result = compileFile(input)

  assert.deepEqual(result, { input, output: path.join(dir, 'dist', 'app.js') })
  assert.equal(fs.readFileSync(result.output, 'utf8'), 'const answer = 42\n')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('compileFile honors an explicit output directory and compile options', () => {
  const dir = tempDir()
  const input = path.join(dir, 'app.jojo')
  fs.writeFileSync(input, 'xs |> count\n')

  const result = compileFile(input, path.join(dir, 'out'), { runtimeImport: 'custom/runtime' })

  assert.equal(result.output, path.join(dir, 'out', 'app.js'))
  assert.match(fs.readFileSync(result.output, 'utf8'), /import \{ count \} from "custom\/runtime"/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('compileDirectory mirrors nested .jojo files and skips dependencies, output, and hidden entries', () => {
  const dir = tempDir()
  fs.mkdirSync(path.join(dir, 'nested'))
  fs.mkdirSync(path.join(dir, 'node_modules'))
  fs.mkdirSync(path.join(dir, 'dist'))
  fs.mkdirSync(path.join(dir, '.cache'))
  fs.writeFileSync(path.join(dir, 'main.jojo'), 'a := 1\n')
  fs.writeFileSync(path.join(dir, 'nested', 'util.jojo'), 'b := 2\n')
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not jojo\n')
  fs.writeFileSync(path.join(dir, 'node_modules', 'dep.jojo'), 'c := 3\n')
  fs.writeFileSync(path.join(dir, 'dist', 'old.jojo'), 'd := 4\n')
  fs.writeFileSync(path.join(dir, '.cache', 'hidden.jojo'), 'e := 5\n')

  const outputs = compileDirectory(dir).map(item => path.relative(dir, item.output)).sort()

  assert.deepEqual(outputs, [path.join('dist', 'main.js'), path.join('dist', 'nested', 'util.js')])
  assert.equal(fs.readFileSync(path.join(dir, 'dist', 'nested', 'util.js'), 'utf8'), 'const b = 2\n')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('compileDirectory writes into an explicit output directory', () => {
  const dir = tempDir()
  fs.writeFileSync(path.join(dir, 'main.jojo'), 'a := 1\n')

  const [item] = compileDirectory(dir, path.join(dir, 'build'))

  assert.equal(item.output, path.join(dir, 'build', 'main.js'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('compile merges pipeline imports into an existing runtime import instead of duplicating it', () => {
  const output = compile('import { toArray } from "@panagos/jojoscript/runtime"\nresult := xs |> map(f) |> toArray\n')

  assert.equal(output.match(/import \{/g).length, 1)
  assert.match(output, /import \{ toArray, map \} from "@panagos\/jojoscript\/runtime"/)
})

test('an explicit runtimeImport option also rewrites runtime imports in files without pipelines', () => {
  assert.equal(
    compile('import { random } from "@panagos/jojoscript/runtime"\n', { runtimeImport: 'file:///runtime/index.js' }),
    'import { random } from "file:///runtime/index.js"\n'
  )
  assert.equal(compile('import { random } from "jojoscript/runtime"\n'), 'import { random } from "jojoscript/runtime"\n')
})
