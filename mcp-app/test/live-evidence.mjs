import assert from "node:assert/strict";

const endpoint = process.argv[2];
if (!endpoint?.startsWith("https://")) throw new Error("Provide the deployed HTTPS MCP endpoint.");
let id = 0;
async function rpc(method, params) {
  const response = await fetch(endpoint, {
    method: "POST", signal: AbortSignal.timeout(120000),
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(!body.error, JSON.stringify(body.error));
  assert.ok(!body.result.isError, JSON.stringify(body.result.content));
  return body.result;
}
const listed = await rpc("tools/list", {});
assert.deepEqual(listed.tools.map(t => t.name).sort(),
  ["list-inventory-items", "list-inventory-stockout-risks", "show-inventory-spatial-hotspots", "show-supply-chain-graph"]);
const riskTool = listed.tools.find(t => t.name === "list-inventory-stockout-risks");
assert.ok(!riskTool._meta?.ui, "The basic risk list must not launch an MCP App");
const riskResult = await rpc("tools/call", { name: riskTool.name, arguments: {} });
const risks = riskResult.structuredContent;
assert.equal(risks.source, "oracle-ai-database-agent");
assert.equal(risks.riskMetric, "STOCKOUT_PROBABILITY");
assert.ok(risks.taskId && risks.contextId);
assert.ok(!riskResult._meta?.ui);
assert.ok(riskResult.content.every(c => c.type === "text"));
assert.ok(risks.items.length > 0);
assert.ok(risks.items.every((r, i) => r.stockoutProbability > 0 && r.stockoutProbability <= 1
  && (!i || r.stockoutProbability <= risks.items[i - 1].stockoutProbability)));
console.log("Stockout risks:", JSON.stringify(risks));
const catalog = (await rpc("tools/call", { name: "list-inventory-items", arguments: {} })).structuredContent;
assert.equal(catalog.source, "oracle-ai-database-agent");
assert.equal(catalog.scope, "FINANCIAL.SC_PRODUCTS");
assert.ok(catalog.taskId);
console.log("Catalog:", JSON.stringify(catalog));
for (const sku of ["SKU-500", "SKU-700", "SKU-APAC-210", "SKU-501", "GRID-CTRL"]) {
  const result = (await rpc("tools/call", {
    name: "show-inventory-spatial-hotspots", arguments: { sku }
  })).structuredContent;
  assert.equal(result.source, "oracle-ai-database-agent");
  assert.equal(result.sku, sku);
  assert.ok(result.taskId);
  assert.ok(result.hotspots.every(h => h.sku === sku && h.warehouseId && h.riskScore >= 0 && h.riskScore <= 1));
  assert.equal(result.status, result.hotspots.length ? "DATA" : "NO_DATA");
  if (["SKU-500", "SKU-700", "SKU-APAC-210"].includes(sku)) assert.ok(result.hotspots.length);
  else {
    assert.equal(result.status, "NO_DATA");
    assert.match(result.interpretation, /unknown/);
    assert.deepEqual(result.route, []);
  }
  console.log(sku, JSON.stringify({status: result.status, taskId: result.taskId, hotspots: result.hotspots, route: result.route}));
}
console.log("PASS: live managed-agent plain risk list, catalog, product identity, no-data and no-Toolkit contracts.");
