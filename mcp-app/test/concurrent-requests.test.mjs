import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { test } from "node:test";

test("overlapping spatial requests have independent MCP transports", async () => {
  const requestedSkus = [];
  const upstream = createServer((req, res) => {
    const sku = new URL(req.url, "http://localhost").searchParams.get("sku");
    requestedSkus.push(sku);
    // Hold the first request open while the second connects.
    setTimeout(() => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ source: "oracle-ai-database-agent", sku,
        hotspots: [], route: [] }));
    }, 200);
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: "0", MCP_BIND_HOST: "127.0.0.1",
      ORACLE_SPATIAL_EVIDENCE_URL: `http://127.0.0.1:${upstream.address().port}/spatial` },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error("Server startup timed out")), 10000);
      child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
      child.stdout.on("data", data => {
        output += data;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/mcp/);
        if (match) { clearTimeout(timeout); resolve(match[0]); }
      });
    });
    const responses = await Promise.all(["SKU-500", "SKU-501"].map(async sku => {
      const response = await fetch(endpoint, {
        method: "POST", signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({jsonrpc: "2.0", id: sku, method: "tools/call",
          params: {name: "show-inventory-spatial-hotspots", arguments: {sku}}})
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.result.isError, undefined);
      assert.equal(body.result.structuredContent.sku, sku);
      return body;
    }));
    assert.equal(responses.length, 2);
    assert.deepEqual(requestedSkus.sort(), ["SKU-500", "SKU-501"]);
  } finally {
    child.kill();
    await once(child, "exit");
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  }
});
