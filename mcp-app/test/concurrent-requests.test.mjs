import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { test } from "node:test";

test("overlapping spatial requests have independent MCP transports", async () => {
  const requestedSkus = [];
  const graphRequests = [];
  let riskRequests = 0;
  const upstream = createServer((req, res) => {
    if (req.url === "/api/inventory/stockout-risks") {
      riskRequests++;
      if (riskRequests > 1) { res.writeHead(503); res.end("Unavailable"); return; }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({source:"oracle-ai-database-agent",scope:"TEST.SC_INVENTORY_RISK_DEMO_V",
        status:"NO_DATA",items:[],totalRows:0,truncated:false,riskMetric:"STOCKOUT_PROBABILITY",
        riskScale:"0–1",taskId:"task",contextId:"context",query:"SELECT"})); return;
    }
    if (req.url.startsWith("/api/inventory/supply-chain-graph")) {
      graphRequests.push(req.url);
      res.writeHead(503); res.end("Upstream unavailable"); return;
    }
    const sku = new URL(req.url, "http://localhost").searchParams.get("sku");
    requestedSkus.push(sku);
    // Hold the first request open while the second connects.
    setTimeout(() => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ source: "oracle-ai-database-agent", sku,
        hotspots: [], route: [], status: "NO_DATA", scope: "TEST.SC_INVENTORY_RISK_DEMO_V",
        taskId: "test-task", query: "test-query", interpretation: "No rows; risk unknown.",
        riskMetric: "HOTSPOT_SCORE", riskScale: "0–1", routeKind: "schematic-source-destination-link" }));
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
    const listed = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({jsonrpc: "2.0", id: 3, method: "tools/list", params: {}})
    }).then(r => r.json());
    assert.deepEqual(listed.result.tools.map(t => t.name).sort(),
      ["list-inventory-items", "list-inventory-stockout-risks", "show-inventory-spatial-hotspots", "show-supply-chain-graph"]);
    assert.equal(listed.result.tools.find(t => t.name === "list-inventory-stockout-risks")._meta?.ui, undefined);
    for (const isFailure of [false, true]) {
      const risk = await fetch(endpoint, {
        method:"POST", headers:{"Content-Type":"application/json",Accept:"application/json, text/event-stream"},
        body:JSON.stringify({jsonrpc:"2.0",id:10 + riskRequests,method:"tools/call",
          params:{name:"list-inventory-stockout-risks",arguments:{}}})
      }).then(r => r.json());
      assert.equal(Boolean(risk.result.isError), isFailure);
      assert.equal(risk.result._meta?.ui, undefined);
      if (!isFailure) assert.equal(risk.result.structuredContent.status, "NO_DATA");
    }
    assert.equal(riskRequests, 2, "Exactly one upstream risk query per request");
    assert.equal(requestedSkus.length, 2, "Risk list never opens spatial views or falls back to them");
    const failed = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({jsonrpc: "2.0", id: 4, method: "tools/call", params: {
        name: "show-supply-chain-graph", arguments: {sku: "SKU-700", oracleAgentEvidence: {nodes: [{id: "invented"}]}}
      }})
    }).then(r => r.json());
    assert.equal(failed.result.isError, true);
    assert.equal(failed.result.structuredContent, undefined);
    assert.deepEqual(graphRequests, ["/api/inventory/supply-chain-graph?sku=SKU-700"]);
    assert.equal(requestedSkus.length, 2, "No alternate upstream endpoint called after graph failure");
  } finally {
    child.kill();
    await once(child, "exit");
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  }
});
