import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"

const server = () => spawn(process.execPath, ["dist/application/mcp-stdio-example.js"], {
  cwd: new URL("..", import.meta.url),
  stdio: ["pipe", "pipe", "pipe"]
})

test("the MCP-style server initializes and exposes a schema-defined tool", async () => {
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
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "example-client", version: "1.0.0" }
    }
  }) + "\n")
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "echo", arguments: { value: "hello" } }
  }) + "\n")
  child.stdin.end()

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", resolve)
  })

  assert.equal(exitCode, 0)

  const responses = output.trim().split("\n").map(JSON.parse)
  assert.deepEqual(responses, [
    {
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "JojoScript", version: "0.10.0" }
      }
    },
    {
      jsonrpc: "2.0",
      id: 2,
      result: {
        content: [{ type: "text", text: "hello" }]
      }
    }
  ])
})
