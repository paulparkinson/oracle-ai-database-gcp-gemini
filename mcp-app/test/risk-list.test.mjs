import assert from "node:assert/strict";
import { test } from "node:test";
import { riskListResult } from "../src/risk-list.ts";
const fixture = {source:"oracle-ai-database-agent",scope:"FINANCIAL.SC_INVENTORY_RISK_DEMO_V",status:"DATA",
  riskMetric:"STOCKOUT_PROBABILITY",riskScale:"0–1",taskId:"task",contextId:"context",query:"SELECT",
  totalRows:1,truncated:false,items:[{sku:"SKU-500",productName:"Widget",quarter:"2026-Q4",riskLevel:"HIGH",stockoutProbability:.72,primaryRegion:"Northeast"}]};
test("risk list is plain text without an app resource or map payload", () => {
  const r = riskListResult(fixture);
  assert.equal(r._meta, undefined);
  assert.equal(r.structuredContent.geojson, undefined);
  assert.match(r.content[0].text, /SKU-500.*0.72/);
  assert.doesNotMatch(r.content[0].text, /ui:\/\//);
});
test("risk result rejects mixed metrics, wrong scales and inconsistent summaries", () => {
  for (const change of [{riskMetric:"HOTSPOT_SCORE"},{status:"NO_DATA"},{contextId:""},{totalRows:0},
    {items:[{...fixture.items[0],stockoutProbability:72}]}, {items:[...fixture.items,...fixture.items]}])
    assert.throws(() => riskListResult({...fixture,...change}));
  const empty = riskListResult({...fixture,status:"NO_DATA",items:[],totalRows:0});
  assert.match(empty.content[0].text, /unknown/);
});
