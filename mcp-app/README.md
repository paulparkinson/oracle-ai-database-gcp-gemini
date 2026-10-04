# Oracle Supply-Chain MCP App: managed-agent reads

This is the maintained MCP server, MapLibre map and Cytoscape.js graph in
`oracle-ai-database-gcp-gemini`. The existing Gemini Enterprise **Oracle
Supply-Chain MCP App** connector can expose three read-only actions:

| Gemini action / MCP tool | Input | Result |
| --- | --- | --- |
| List-inventory-items / `list-inventory-items` | None | Managed-agent catalog, product IDs/names, scope and A2A task ID. |
| Show-inventory-spatial-hotspots / `show-inventory-spatial-hotspots` | `sku`; optional `maximumRows` (2–50, default 20) | Validated warehouse rows, provenance fields, GeoJSON and `ui://oracle-supply-chain/spatial-hotspots-v6`. |
| Show-supply-chain-graph / `show-supply-chain-graph` | `sku` only | Managed-agent dependency rows transformed to typed nodes/edges and `ui://oracle-supply-chain/supply-chain-graph-v1`. |

```text
Gemini Enterprise → MCP server → Java gateway
  → server-side OAuth token exchange/cache
    → Oracle AI Database Agent via A2A/private relay
      → validated spatial JSON → GeoJSON → MapLibre MCP App
```

The gateway queries the managed Oracle agent, not the Toolkit spatial endpoint.
The spatial tool does not accept Gemini-supplied coordinates or evidence and
has no static/Toolkit/Select AI fallback. Failures are errors; `NO_DATA` means
risk unknown in the scoped view. The tables contain seeded demo data that is
read live, not production inventory telemetry.

## Try it

Enable all three actions on the same connector. Reload custom actions only after
tool/schema changes, then start a fresh chat. Try:

- “List the product IDs and names in the managed Oracle inventory catalog.”
- “Show the spatial hotspot map for SKU-700.”
- “Show the spatial hotspot map for SKU-APAC-210.”
- “Map SKU-900 and summarize only the returned warehouse roles and scores.”
- “Show the spatial hotspot map for SKU-501. If no rows are returned, say risk is unknown.”
- “Use Show-supply-chain-graph for SKU-700.”
- “Show the supply-chain dependency graph for SKU-900 and describe only its returned relationships.”

The [graph runbook](../docs/MCP_APP_ORACLE_AGENT_GRAPH.md) covers the exact query
scope, interactive checks and screenshots. The graph reads relationship tables
through the managed agent, not `GRAPH_TABLE`, Toolkit or direct JDBC. Cytoscape
is bundled: no CDN, tile provider, generated image or browser OAuth is involved.

![Verified SKU-700 map with source, destination and satellite warehouses.](../docs/images/managed-agent-sku700-v6.jpg)

Pan/zoom and point clicks inspect the returned result. Ask again for a new
query. Lines are schematic source/destination connections, not road routing
or transfer recommendations. Scores are 0–1 hotspot scores, not probabilities.
See the [full runbook](../docs/MCP_APP_ORACLE_AGENT_SPATIAL.md) for more prompts,
screenshots, OAuth setup/renewal, deployment, known limits and provenance checks.

## Build and run locally

Requires Node.js 20.19+ or 22.12+. From this directory:

```bash
npm ci --ignore-scripts
npm run typecheck
npm run build
```

First configure/start the Java gateway using the
[runbook's local verification steps](../docs/MCP_APP_ORACLE_AGENT_SPATIAL.md#local-verification).
Then start this server:

```bash
ORACLE_SPATIAL_EVIDENCE_URL=http://127.0.0.1:18090/api/inventory/spatial-hotspots \
MCP_WRITES_ENABLED=false PORT=13001 MCP_BIND_HOST=127.0.0.1 npm run serve
```

Connect an MCP client to `http://127.0.0.1:13001/mcp`. Catalog requests use the
same gateway origin at `/api/inventory/catalog`. `AGENT_SERVICE_URL` is also
used by legacy Toolkit paths; set `ORACLE_SPATIAL_EVIDENCE_URL` explicitly so
the managed read gateway is unambiguous.

## Verify the right source

```bash
node --test test/concurrent-requests.test.mjs
node test/live-evidence.mjs https://YOUR_MCP_SERVICE/mcp
```

The first test uses a local fixture. The second calls the live MCP server and
checks catalog, multiple SKUs, row identity, task IDs and NO_DATA without
inventory writes. Neither a `source` label nor Gemini's `Load Skill`/Google
Search trace proves SQL execution. Follow the
[three-level verification procedure](../docs/MCP_APP_ORACLE_AGENT_SPATIAL.md#verify-provenance-not-just-a-working-map):
host tool trace, authenticated server/A2A call, independent Oracle row/audit
comparison. The returned `query` is requested SQL, not an execution receipt.

## Boundaries and deployment

- [server.ts](server.ts) obtains/validates results; the sandboxed map renders
  them. OAuth secrets remain in the Java service, never in iframe arguments.
- Map tiles are separate OpenStreetMap requests. Their origins must be
  permitted by the resource CSP/network policy; tile success is not data proof.
- `MCP_WRITES_ENABLED=false` advertises only catalog, spatial and graph tools. Legacy
  transfer-dashboard/write code is not the current read-only connector flow.
- Transfer review belongs to A2A/A2UI and governed Toolkit operations. The
  current Java A2UI implementation is draft/review, not a verified committed
  inventory transfer. See [two-lane architecture](../docs/INVENTORY_UI_ARCHITECTURE.md).
- Deploy both services with
  [deploy-oracle-agent-and-mcp-app.sh](../deploy/gcp/deploy-oracle-agent-and-mcp-app.sh)
  only after configuring its project and Secret Manager prerequisites. It
  allows unauthenticated Cloud Run ingress for the demo. Production requires
  ingress/caller authorization and an explicit service-vs-user identity design;
  upstream Oracle OAuth does not protect the public gateway from callers.

For assisted maintenance, give ChatGPT/Claude the
[`inventory-ui-architecture` skill](../.agents/skills/inventory-ui-architecture/SKILL.md)
and the runbook. That development skill is distinct from Gemini's runtime
“Load Skill” event and does not itself execute a database query.
