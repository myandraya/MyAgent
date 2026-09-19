import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("真实 stdio MCP server 可列出并调用三工具", { timeout: 15_000 }, async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--experimental-strip-types", "mcp/server.ts"], cwd: process.cwd(), stderr: "pipe" });
  const client = new Client({ name: "shike-test", version: "0.1.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["check_dfm", "generate_star_svg", "query_star_map"]);
    const called = await client.callTool({ name: "query_star_map", arguments: { city: "edinburgh", date: "2023-06-01", size_mm: 300 } });
    assert.equal(called.isError, undefined);
    assert.match(JSON.stringify(called.content), /Edinburgh/);
  } finally {
    await client.close();
  }
});
