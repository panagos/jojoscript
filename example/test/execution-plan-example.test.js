import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import url from "node:url"

import { analyzePipelines } from "jojoscript"

const file = path.join(
  path.dirname(url.fileURLToPath(import.meta.url)),
  "..",
  "src",
  "effects",
  "execution-plan.jojo"
)

test("the execution plan exposes which nodes use which effects, and whether they are statically handled", () => {
  const source = fs.readFileSync(file, "utf8")
  const [graph] = analyzePipelines(source)

  assert.deepEqual(graph.effects, [
    { name: "fetchUser", nodeId: "node-1", staticallyHandled: true },
    { name: "saveUser", nodeId: "node-3", staticallyHandled: false }
  ])
})
