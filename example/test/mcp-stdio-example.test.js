import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"

const server = () => spawn(process.execPath, ["dist/application/mcp-stdio-example.js"], {
  cwd: new URL("..", import.meta.url),
  stdio: ["pipe", "pipe", "pipe"]
})

test("the MCP-style server exposes a tool and responds to JSON-RPC requests", async () => {
  const child = server()
  let output = ""

  child.stdout.on("data", chunk => {
    output += chunk
  })

  child.stderr.on("data", chunk => {
    output += chunk
  })

  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "echo", arguments: { value: "hello" } }
  }) + "\n")
  child.stdin.end()

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", resolve)
  })

  assert.equal(exitCode, 0)

  const response = JSON.parse(output)
  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: "hello" }]
    }
  })
})
