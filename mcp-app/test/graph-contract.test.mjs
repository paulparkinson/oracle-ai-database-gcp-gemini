import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphEvidence } from "../src/graph-contract.ts";
const graph = { source: "oracle-ai-database-agent", sku: "SKU-700", status: "DATA", pathRows: 1,
  scope: "TEST.SUPPLY_CHAIN_GRAPH", taskId: "fixture-task", query: "fixture-query", sourceDetail: "fixture", executionMode: "fixture",
  interpretation: "Fixture, not a live database result", nodes: [
    { id: "warehouse:4", databaseId: "4", sku: "SKU-700", kind: "WAREHOUSE", label: "Warehouse" },
    { id: "product:SKU-700", databaseId: "SKU-700", sku: "SKU-700", kind: "PRODUCT", label: "Kit" }],
  edges: [{ id: "warehouse:4|STOCKS|product:SKU-700", sku: "SKU-700", source: "warehouse:4", target: "product:SKU-700", kind: "STOCKS" }] };
test("valid graph and explicit empty graph", () => {
  assert.equal(GraphEvidence.parse(graph).nodes.length, 2);
  assert.equal(GraphEvidence.parse({ ...graph, status: "NO_DATA", nodes: [], edges: [], pathRows: 0 }).status, "NO_DATA");
});
test("rejects wrong product, dangling/reversed edges, duplicates and fake source", () => {
  for (const mutate of [g => g.nodes[0].sku = "SKU-500", g => g.edges[0].target = "missing",
    g => g.edges[0].kind = "SUPPLIES", g => g.nodes.push(g.nodes[0]),
    g => g.source = "toolkit", g => g.taskId = "", g => g.status = "NO_DATA",
    g => g.nodes[1].databaseId = "SKU-500"]) {
    const invalid = structuredClone(graph); mutate(invalid); assert.equal(GraphEvidence.safeParse(invalid).success, false);
  }
});
