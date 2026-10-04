import { App } from "@modelcontextprotocol/ext-apps";
import cytoscape, { type Core, type LayoutOptions, type NodeSingular, type EdgeSingular } from "cytoscape";
import { GraphEvidence } from "./graph-contract";

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const app = new App({ name: "Oracle Supply-Chain Graph", version: "1.0.0" });
let cy: Core | undefined;
const controls = ["find", "fit", "zoom-in", "zoom-out", "layout"];
function reset() {
  cy?.destroy(); cy = undefined; el("graph").hidden = true;
  controls.forEach(id => (el<HTMLButtonElement>(id).disabled = true));
  for (const id of ["summary", "provenance", "query", "details"]) el(id).textContent = "";
}
app.ontoolresult = result => {
  reset();
  try {
    if (result.isError) throw new Error("Managed Oracle graph query failed. No fallback was used.");
    const graph = GraphEvidence.parse(result.structuredContent);
    el("title").textContent = `Supply-chain dependencies · ${graph.sku}`;
    el("summary").textContent = graph.interpretation;
    el("provenance").textContent = `${graph.source} · ${graph.scope} · A2A task ${graph.taskId}`;
    el("query").textContent = graph.query;
    if (graph.status === "NO_DATA") {
      el("status").textContent = "No complete active paths returned. Supply-chain risk is unknown.";
      return;
    }
    el("graph").hidden = false;
    cy = cytoscape({ container: el("graph"), elements: [
      ...graph.nodes.map(data => ({ data })), ...graph.edges.map(data => ({ data }))
    ], minZoom: 0.2, maxZoom: 3, wheelSensitivity: 0.25,
    style: [
      { selector: "node", style: { label: "data(label)", "background-color": "#377eb8", color: "#1c2833",
        "text-valign": "bottom", "text-margin-y": 9, "font-size": 12, "text-wrap": "wrap", "text-max-width": "115px",
        width: 40, height: 40, "border-color": "#fff", "border-width": 2 } },
      { selector: 'node[kind="PRODUCT"]', style: { "background-color": "#8154ae", shape: "round-rectangle" } },
      { selector: 'node[kind="SUPPLIER"]', style: { "background-color": "#247a50" } },
      { selector: 'node[kind="WAREHOUSE"]', style: { "background-color": "#bd761c", shape: "round-rectangle" } },
      { selector: 'node[kind="ALERT"]', style: { "background-color": "#c84432", shape: "diamond" } },
      { selector: "edge", style: { label: "data(kind)", width: 2, "line-color": "#617b92", "target-arrow-color": "#617b92",
        "target-arrow-shape": "triangle", "curve-style": "bezier", "font-size": 9, color: "#31465a", "text-background-color": "#f5f7fa", "text-background-opacity": 1, "text-background-padding": "3px" } },
      { selector: ":selected", style: { "overlay-color": "#177da8", "overlay-opacity": 0.15, "overlay-padding": 8 } }
    ], layout: { name: "breadthfirst", directed: true, padding: 50, spacingFactor: 1.25 } });
    cy.on("tap", "node", event => {
      const node = event.target as NodeSingular;
      el("details").textContent = `${node.data("label")}\nType: ${node.data("kind")} · Database ID: ${node.data("databaseId")} · SKU: ${node.data("sku")}\n`
        + node.connectedEdges().map(e => `${e.source().data("label")} → ${e.data("kind")} → ${e.target().data("label")}`).join("\n");
    });
    cy.on("tap", "edge", event => {
      const edge = event.target as EdgeSingular;
      el("details").textContent = `${edge.source().data("label")} → ${edge.data("kind")} → ${edge.target().data("label")}\nSKU: ${edge.data("sku")}\nRelationship key: ${edge.id()} (UI key, not an Oracle edge primary key)`;
    });
    controls.forEach(id => (el<HTMLButtonElement>(id).disabled = false));
    el("status").textContent = `${graph.nodes.length} nodes · ${graph.edges.length} relationships · Interactive Cytoscape.js graph`;
    el("details").textContent = "Select a node or edge to inspect its database identifiers and relationships.";
  } catch (error) {
    el("status").textContent = error instanceof Error && !error.message.startsWith("[")
      ? error.message : "Graph evidence failed validation. No graph or fallback was rendered.";
  }
};
el("fit").onclick = () => cy?.fit(undefined, 50);
el("zoom-in").onclick = () => cy?.zoom(cy.zoom() * 1.25);
el("zoom-out").onclick = () => cy?.zoom(cy.zoom() / 1.25);
el("layout").onchange = () => cy?.layout({ name: el<HTMLSelectElement>("layout").value, directed: true, padding: 50, animate: false } as LayoutOptions).run();
el("find").onclick = () => {
  if (!cy) return;
  const query = el<HTMLInputElement>("search").value.trim().toLowerCase();
  const matches = cy.nodes().filter(n => `${n.data("label")} ${n.data("databaseId")} ${n.data("kind")}`.toLowerCase().includes(query));
  cy.elements().unselect(); matches.select();
  if (matches.length) { cy.fit(matches.closedNeighborhood(), 70); matches.first().emit("tap"); }
  else el("details").textContent = "No matching node in this returned graph.";
};
new ResizeObserver(() => cy?.resize()).observe(el("graph"));
void app.connect().catch(() => { el("status").textContent = "MCP host connection failed. Reopen the graph action in a supported host."; });
