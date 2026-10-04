// Real MCP result + resource in a minimal protocol host. This is not a Gemini UI test.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { chromium } from "playwright";
const endpoint = process.argv[2];
const sku = process.argv[3] ?? "SKU-700";
const screenshot = process.argv[4];
if (!endpoint) throw new Error("Usage: node test/graph-ui.mjs MCP_URL [SKU] [SCREENSHOT.png]");
let id = 0;
async function rpc(method, params) {
  const response = await fetch(endpoint, { method: "POST", signal: AbortSignal.timeout(150000),
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({jsonrpc: "2.0", id: ++id, method, params}) });
  assert.equal(response.status, 200);
  const body = await response.json(); assert.ok(!body.error, JSON.stringify(body.error));
  assert.ok(!body.result.isError, JSON.stringify(body.result.content)); return body.result;
}
const result = await rpc("tools/call", {name: "show-supply-chain-graph", arguments: {sku}});
const resources = await rpc("resources/read", {uri: "ui://oracle-supply-chain/supply-chain-graph-v1"});
const html = resources.contents[0].text;
assert.deepEqual(resources.contents[0]._meta.ui.csp, {connectDomains: [], resourceDomains: []});
const server = createServer((req,res) => {
  res.setHeader("Content-Type", "text/html");
  if (req.url === "/app") {
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'");
    res.end(html);
  } else res.end('<!doctype html><title>Local MCP protocol test host</title><iframe title="Graph MCP App" src="/app" sandbox="allow-scripts allow-same-origin" style="width:100%;height:1040px;border:0"></iframe>');
});
server.listen(0, "127.0.0.1"); await once(server,"listening");
let browser;
try {
  browser = await chromium.launch({channel:"chrome", headless:true});
  const page = await browser.newPage({viewport:{width:1300,height:1100},deviceScaleFactor:1});
  const errors=[]; page.on("pageerror", e=>errors.push(e.message));
  await page.addInitScript(result => {
    if (window !== window.top) return;
    window.addEventListener("message", event => {
      const m=event.data;
      if (m?.method === "ui/initialize") event.source.postMessage({jsonrpc:"2.0",id:m.id,result:{
        protocolVersion:"2026-01-26",hostInfo:{name:"Local verification host",version:"1"},hostCapabilities:{},hostContext:{theme:"dark"}
      }},"*");
      if (m?.method === "ui/notifications/initialized") event.source.postMessage({jsonrpc:"2.0",method:"ui/notifications/tool-result",params:result},"*");
    });
  },result);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const frame = page.frameLocator("iframe");
  if (result.structuredContent.status === "NO_DATA") {
    await frame.getByText("No complete active paths returned. Supply-chain risk is unknown.",{exact:true}).waitFor();
    assert.equal(await frame.locator("#graph").isVisible(),false);
  } else {
    await frame.getByText(/Interactive Cytoscape.js graph/).waitFor();
    const cyState = () => frame.locator("#graph").evaluate(el => {
      const cy = el._cyreg.cy;
      return {zoom:cy.zoom(),pan:cy.pan(),count:cy.nodes().length,positions:cy.nodes().map(n=>({id:n.id(),p:n.position()}))};
    });
    const before=await cyState(); assert.equal(before.count,result.structuredContent.nodes.length);
    await frame.getByRole("button",{name:"Zoom in",exact:true}).click();
    assert.ok((await cyState()).zoom > before.zoom);
    await frame.getByRole("button",{name:"Fit graph",exact:true}).click();
    const supplier=result.structuredContent.nodes.find(n=>n.kind==="SUPPLIER");
    await frame.getByRole("textbox",{name:"Find node"}).fill(supplier.label);
    await frame.getByRole("button",{name:"Find",exact:true}).click();
    assert.match(await frame.locator("#details").innerText(),/Database ID:/);
    await frame.getByRole("combobox",{name:"Graph layout"}).selectOption("circle");
    const after=await cyState(); assert.notDeepEqual(after.positions,before.positions);
    // Real pointer interaction at a rendered node/edge, not just dispatching a synthetic tap.
    const nodePoint=await frame.locator("#graph").evaluate(el=>el._cyreg.cy.nodes()[0].renderedPosition());
    await frame.locator("#graph").click({position:nodePoint});
    assert.match(await frame.locator("#details").innerText(),/Database ID:/);
    const edgePoint=await frame.locator("#graph").evaluate(el=>el._cyreg.cy.edges()[0].renderedMidpoint());
    await frame.locator("#graph").click({position:edgePoint});
    assert.match(await frame.locator("#details").innerText(),/Relationship key:/);
    const box=await frame.locator("#graph").boundingBox();
    const start={x:box.x+nodePoint.x,y:box.y+nodePoint.y};
    await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+30,start.y+20,{steps:8});await page.mouse.up();
    assert.notDeepEqual((await cyState()).positions,after.positions);
    const panBefore=(await cyState()).pan;
    await page.mouse.move(box.x+12,box.y+12);await page.mouse.down();await page.mouse.move(box.x+45,box.y+35,{steps:8});await page.mouse.up();
    assert.notDeepEqual((await cyState()).pan,panBefore);
    await frame.getByRole("combobox",{name:"Graph layout"}).selectOption("breadthfirst");
    await frame.getByRole("button",{name:"Find",exact:true}).click();
    await frame.getByRole("button",{name:"Fit graph",exact:true}).click();
  }
  if(screenshot) await page.screenshot({path:screenshot,fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({test:"graph-ui",sku,status:result.structuredContent.status,taskId:result.structuredContent.taskId,nodes:result.structuredContent.nodes.length,edges:result.structuredContent.edges.length,screenshot}));
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(r=>server.close(r));
}
