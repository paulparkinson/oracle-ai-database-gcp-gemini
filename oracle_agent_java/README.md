# Oracle Java Agent Runtime for Gemini Enterprise

This README uses placeholders such as `YOUR_PUBLIC_AGENT_HOST`, `YOUR_LE_CERT_NAME`, `YOUR_SELECT_AI_PROFILE_NAME`, and `/path/to/repo-root` instead of live environment values. Replace them with your own values before running the commands here.

This directory now holds the shared Java/Spring Boot A2A runtime for the Oracle demo's Java-served agent experiences.

Today, the same Java process serves five agent surfaces:

- graph agent at `/graph`
- spatial hotspot agent at `/spatial`
- Select AI-style inventory analyst at `/select-ai`
- inventory-system gateway at `/inventory-system`
- inventory-action coordinator at `/inventory-action`

The legacy root `/` graph surface still exists for backward compatibility, but `/graph` is now the canonical graph route.

The maintained MCP graph uses **Cytoscape.js**, and the map uses **MapLibre**.
Both obtain rows through the managed Oracle AI Database Agent. The obsolete
spatial Java2D/JTS renderer, its seeded fallback and bundled basemap files have
been removed. The legacy `/graph` A2A image/payload renderer is retained for
compatibility, but is **not called by the MCP graph action**. The legacy graph
configuration/examples below do not apply to the managed MCP read path.

## Related Files

### Java gateway for the managed-agent MCP read path

The same Java codebase also supplies the Cloud Run gateway used by the
catalog/MapLibre/Cytoscape MCP Apps. The `/spatial` A2A adapter now returns a
managed-agent text summary and points users to the MCP map, not a PNG:

```text
Gemini Enterprise → MCP App server → Java gateway
  → OAuth token exchange/cache → managed Oracle AI Database Agent via A2A
    → validated rows → MapLibre map / Cytoscape.js graph MCP App
```

`GET /api/inventory/catalog` and
`GET /api/inventory/spatial-hotspots?sku=SKU-700` and
`GET /api/inventory/supply-chain-graph?sku=SKU-700` ask the managed agent to query
the configured Oracle schema. This path rejects model-passed evidence and has
no local Select AI/Toolkit/static-data fallback. The gateway keeps client
secrets and refresh grants server-side, renews/caches access tokens, and
centralizes row validation. Initial browser consent is still needed; map
requests do not normally require repeated consent.

This deployment uses its stored grant's identity, not automatically the
identity of every Gemini user. The demo gateway's public ingress needs caller
authorization before production. See the
[managed read runbook](../docs/MCP_APP_ORACLE_AGENT_SPATIAL.md) for exact setup,
why this boundary exists, renewal limits, dynamic examples, and the distinction
between an authenticated A2A call and independent Oracle SQL audit proof.
The [graph runbook](../docs/MCP_APP_ORACLE_AGENT_GRAPH.md) explains the explicit
SC_* relational traversal (not GRAPH_TABLE), typed-node validation, bounded
results, dynamic examples and browser tests. Failed queries return HTTP 502;
invalid SKU syntax returns 400; an empty scoped result returns NO_DATA.

### Other runtime references

- [`../sql/setup_supply_chain_graph_schema.sql`](../sql/setup_supply_chain_graph_schema.sql): shared idempotent setup DDL for creating the graph demo tables and property graph in Oracle Database.
- [`../sql/seed_supply_chain_graph_data.sql`](../sql/seed_supply_chain_graph_data.sql): shared idempotent sample data seed for three supply-chain paths, including `SKU-500`.
- [`../sql/setup_inventory_risk_demo_schema.sql`](../sql/setup_inventory_risk_demo_schema.sql): shared idempotent setup DDL for the inventory-risk summary, warehouse-geo, and hotspot tables used by the spatial and Select AI flows.
- [`../sql/seed_inventory_risk_demo_data.sql`](../sql/seed_inventory_risk_demo_data.sql): shared idempotent sample data seed for the spatial and Select AI demo tables.
- [`GRAPH_DATA_MODES.md`](GRAPH_DATA_MODES.md): how `GRAPH_DATA_MODE=database|payload|auto` works, the supported JSON contract, and the validation rules for multi-agent flows.
- [`MULTI_AGENT_GRAPH_FLOW.md`](MULTI_AGENT_GRAPH_FLOW.md): architecture notes for direct DB lookup vs upstream-agent payload handoff, including provenance, validation, and recommended `auto` behavior.
- [`HTTPS_SETUP.md`](HTTPS_SETUP.md): step-by-step Let's Encrypt and public HTTPS setup for Gemini Enterprise.
- [`agent-card-graph.json`](agent-cards/agent-card-graph.json): saved snapshot of the primary graph card.
- [`agent-card-spatial.json`](agent-cards/agent-card-spatial.json): saved snapshot of the spatial hotspot card served by the same Java process.
- [`agent-card-select-ai.json`](agent-cards/agent-card-select-ai.json): saved snapshot of the Select AI-style inventory analyst card.
- [`agent-card-oracle-ai-database.json`](agent-cards/agent-card-oracle-ai-database.json): checked-in snapshot of the Oracle-hosted Oracle AI Database agent card used by the inventory-system router.
- [`agent-card-inventory-system.json`](agent-cards/agent-card-inventory-system.json): saved snapshot of the inventory-system gateway card.
- [`ORACLE_AI_DATABASE_DOWNSTREAM_AGENT.md`](ORACLE_AI_DATABASE_DOWNSTREAM_AGENT.md): concise setup notes for using the Oracle AI Database agent behind another agent such as `oracle_inventory_system_agent`.
- [`agent-card-action.json`](agent-cards/agent-card-action.json): saved snapshot of the inventory-action coordinator card.
- [`test_inventory_system.sh`](test_inventory_system.sh): helper for exercising the inventory-system gateway over A2A JSON-RPC.

## Setup Instructions

1. **Build the Agent:**
   ```bash
   ./build.sh
   ```

2. **Run the Agent:**
   ```bash
   ./run.sh
   ```

3. **Test the A2A Endpoint:**
   ```bash
   ./test.sh
   ```

4. **Legacy `/graph` A2A image mode only (not the MCP graph/map):**
   ```bash
   export VISUAL_RENDERER=both
   export GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
   export GOOGLE_API_KEY="your-gemini-api-key"
   ./run.sh
   ```

   `VISUAL_RENDERER=deterministic` is the default and returns only the Java2D source-of-truth PNG.
   `VISUAL_RENDERER=both` returns that same PNG plus a Gemini-generated illustrative PNG. `VISUAL_RENDERER=gemini`
   returns only the Gemini-generated image when the API call succeeds. The default model is
   `gemini-3.1-flash-image`, the current Nano Banana 2 general-purpose image model in the Gemini API.
   Use `gemini-3-pro-image` only when you want the premium model for more complex visual styling.

5. **Run with Public HTTPS for Gemini Enterprise:**
   Gemini Enterprise rejects `http://` agent URLs and expects `https://`.

   For a VM that only has a public IP address, use a publicly trusted IP certificate rather
   than a self-signed certificate:
   ```bash
   CERTBOT_EMAIL="you@example.com" PUBLIC_HOST="YOUR_PUBLIC_AGENT_HOST" ./issue_ip_certificate.sh
   ./sync_ip_certificate.sh
   PUBLIC_HOST="YOUR_PUBLIC_AGENT_HOST" GRAPH_AGENT_PORT="8080" ./run_public_https.sh
   GRAPH_AGENT_URL="https://YOUR_PUBLIC_AGENT_HOST:8080" ./test.sh
   ```

   If Gemini Enterprise ignores the non-standard `:8080` port for your import path, run the
   same agent on standard HTTPS instead:
   ```bash
   sudo env \
     PUBLIC_HOST="YOUR_PUBLIC_AGENT_HOST" \
     PUBLIC_PROTOCOL="https" \
     GRAPH_AGENT_URL="https://YOUR_PUBLIC_AGENT_HOST" \
     GRAPH_AGENT_PORT="443" \
     BIND_HOST="0.0.0.0" \
     SSL_CERTIFICATE="/etc/letsencrypt/live/YOUR_LE_CERT_NAME/fullchain.pem" \
     SSL_CERTIFICATE_PRIVATE_KEY="/etc/letsencrypt/live/YOUR_LE_CERT_NAME/privkey.pem" \
     ./run.sh
   ```

   `issue_ip_certificate.sh` expects:
   - Certbot `5.3.0` or newer
   - inbound TCP `80` open during issuance and renewal
   - nothing else listening on port `80` while Certbot runs

   `sync_ip_certificate.sh` copies the root-owned Let's Encrypt files into a user-readable
   private directory so the non-root Java process can use HTTPS safely.

   Current tested import URLs:
   - graph alias card on the same Java process: `https://YOUR_PUBLIC_AGENT_HOST/agent-card-graph.json`
   - graph dedicated A2A card path: `https://YOUR_PUBLIC_AGENT_HOST/graph/.well-known/agent-card.json`
   - spatial hotspot card on the same Java process: `https://YOUR_PUBLIC_AGENT_HOST/agent-card-spatial.json`
   - Select AI card on the same Java process: `https://YOUR_PUBLIC_AGENT_HOST/agent-card-select-ai.json`
   - inventory-system card on the same Java process: `https://YOUR_PUBLIC_AGENT_HOST/agent-card-inventory-system.json`
   - inventory-action card on the same Java process: `https://YOUR_PUBLIC_AGENT_HOST/agent-card-action.json`
   - mirrored Oracle AI Database card alias: `https://YOUR_PUBLIC_AGENT_HOST/oracle-ai-database-agent-card.json`
   - graph legacy default card path: `https://YOUR_PUBLIC_AGENT_HOST/.well-known/agent-card.json`
   - dedicated spatial A2A card path: `https://YOUR_PUBLIC_AGENT_HOST/spatial/.well-known/agent-card.json`
   - dedicated Select AI A2A card path: `https://YOUR_PUBLIC_AGENT_HOST/select-ai/.well-known/agent-card.json`
   - dedicated inventory-system A2A card path: `https://YOUR_PUBLIC_AGENT_HOST/inventory-system/.well-known/agent-card.json`
   - dedicated inventory-action A2A card path: `https://YOUR_PUBLIC_AGENT_HOST/inventory-action/.well-known/agent-card.json`
   - direct HTTPS on 8080: `https://YOUR_PUBLIC_AGENT_HOST:8080/.well-known/agent-card.json`

   For Gemini Enterprise imports, prefer the five matching alias URLs: `agent-card-graph.json`, `agent-card-spatial.json`, `agent-card-select-ai.json`, `agent-card-inventory-system.json`, and `agent-card-action.json`. The mirrored `oracle-ai-database-agent-card.json` endpoint exposes the external Oracle-hosted card metadata the inventory-system gateway delegates to for general database questions. The canonical graph runtime path is `/graph`, while the legacy root `/.well-known/agent-card.json` endpoint still exists as a compatibility graph card. The spatial, Select AI, inventory-system, and inventory-action cards are real additional agent surfaces in the same Spring Boot process.

   On the GCP VM, a reliable way to keep the `443` deployment alive after SSH exits is to
   start it as a transient `systemd` service instead of a background shell job:
   ```bash
   sudo systemd-run \
     --unit=oracle-graph-agent \
     --description="Oracle Graph Agent HTTPS service" \
     --working-directory="$PWD" \
     --setenv=PUBLIC_HOST="YOUR_PUBLIC_AGENT_HOST" \
     --setenv=PUBLIC_PROTOCOL="https" \
     --setenv=GRAPH_AGENT_URL="https://YOUR_PUBLIC_AGENT_HOST" \
     --setenv=GRAPH_AGENT_PORT="443" \
     --setenv=BIND_HOST="0.0.0.0" \
     --setenv=SSL_CERTIFICATE="/etc/letsencrypt/live/YOUR_LE_CERT_NAME/fullchain.pem" \
     --setenv=SSL_CERTIFICATE_PRIVATE_KEY="/etc/letsencrypt/live/YOUR_LE_CERT_NAME/privkey.pem" \
     "$PWD/run.sh"
   sudo systemctl status oracle-graph-agent.service
   ```

## Gemini Enterprise Payload Prompt

If another agent or workflow already has graph data, keep `GRAPH_DATA_MODE=auto` or `GRAPH_DATA_MODE=payload`
and send the graph as structured JSON in the chat prompt. The parser accepts:

- a raw JSON object as the whole prompt
- a fenced JSON block inside a normal natural-language prompt
- a normal natural-language prompt followed by a raw JSON object pasted below it, even without code fences
- markdown-style escaped brackets such as `\[` and `\]` if the Gemini UI inserts them during paste
- either the payload root itself or `{ "graphPayload": { ... } }`

Recommended Gemini Enterprise prompt:

````text
Render this supply-chain dependency graph exactly from the structured payload below.
Do not query the database.
Use the payload as the authoritative graph input.

```json
{
  "graphPayload": {
    "schemaVersion": "1.0",
    "productId": "SKU-777",
    "nodes": [
      {
        "id": "supplier",
        "type": "SUPPLIER",
        "label": "Supplier: Blue Ocean Resins",
        "detail": "Tier 2 | Singapore",
        "metric": "On-time 97%"
      },
      {
        "id": "plant",
        "type": "PLANT",
        "label": "Plant: Austin Assembly",
        "detail": "Cycle 3.2 days",
        "metric": "Utilization 81%"
      },
      {
        "id": "port",
        "type": "PORT",
        "label": "Port: Long Beach",
        "detail": "ETA 22 hrs",
        "metric": "Delay risk 0.18"
      },
      {
        "id": "warehouse",
        "type": "WAREHOUSE",
        "label": "Warehouse: Reno DC",
        "detail": "Inventory 8120 units",
        "metric": "Fill rate 98%"
      },
      {
        "id": "product",
        "type": "PRODUCT",
        "label": "Product: SKU-777",
        "detail": "Demand +12%",
        "metric": "Margin 34%"
      },
      {
        "id": "alert",
        "type": "ALERT",
        "label": "Alert: Customs Review",
        "detail": "West coast lane",
        "metric": "Risk 0.27"
      }
    ],
    "edges": [
      { "from": "supplier", "to": "plant", "label": "SUPPLIES" },
      { "from": "plant", "to": "port", "label": "SHIPS_VIA" },
      { "from": "port", "to": "warehouse", "label": "ROUTES_TO" },
      { "from": "warehouse", "to": "product", "label": "STOCKS" },
      { "from": "alert", "to": "port", "label": "AFFECTS" }
    ]
  }
}
```
````

If Gemini Enterprise is rewriting surrounding text, you can also send only the JSON object above.

Expected success signal:

- the response text mentions the product and graph path
- the returned PNG artifact renders the exact nodes and edges you supplied
- the metadata reports `sourceMode=payload`

## Inventory Action Coordinator

The same Java process now also serves an ADK-backed inventory-action coordinator at:

- card alias: `https://YOUR_PUBLIC_AGENT_HOST/agent-card-action.json`
- dedicated card path: `https://YOUR_PUBLIC_AGENT_HOST/inventory-action/.well-known/agent-card.json`
- JSON-RPC endpoint: `https://YOUR_PUBLIC_AGENT_HOST/inventory-action`

This coordinator is the first cut of the final-stage action flow described in the root repo README:

- it uses Google ADK Java inside the existing Spring Boot process
- it runs a `ParallelAgent` for graph, spatial, and external evidence gathering
- it follows that with an `LlmAgent` decision step that checks policy and drafts a transfer recommendation
- it does not execute the move; it only recommends and drafts, with approval handling called out in the response
- if the ADK model path is unavailable because Vertex credentials are not refreshed on the host, it falls back to deterministic local orchestration instead of returning a hard failure

Current tool coverage inside the coordinator:

- `getGraphEvidence`: calls the Oracle graph tool directly and summarizes the dependency path
- `getSpatialEvidence`: calls the managed-agent spatial service and returns validated warehouse rows; it does not invent a transfer quantity
- `getExternalSignals`: returns seeded weather or lane-risk context
- `checkTransferPolicy`: decides whether approval is required
- `draftInventoryTransferAction`: creates a draft, not an execution

## Spatial Agent

The same Java process now also serves a dedicated spatial hotspot agent at:

- card alias: `https://YOUR_PUBLIC_AGENT_HOST/agent-card-spatial.json`
- dedicated card path: `https://YOUR_PUBLIC_AGENT_HOST/spatial/.well-known/agent-card.json`
- JSON-RPC endpoint: `https://YOUR_PUBLIC_AGENT_HOST/spatial`

What it does today:

- calls the managed Oracle AI Database Agent through the shared spatial service
- validates rows from the scoped inventory-risk view and returns a text summary
- does not substitute seeded rows on failure or generate a picture
- directs interactive visualization to `Show-inventory-spatial-hotspots`

Recommended Gemini Enterprise prompt:

```text
Show that on a map for SKU-500 and highlight the warehouse hotspots plus the best relief route.
```

Expected response shape:

- managed-agent text summary or explicit failure/no-data result
- MapLibre interaction is available through the MCP App, not an A2A PNG artifact

## Select AI Agent

The same Java process now also serves a Select AI-style analyst at:

- card alias: `https://YOUR_PUBLIC_AGENT_HOST/agent-card-select-ai.json`
- dedicated card path: `https://YOUR_PUBLIC_AGENT_HOST/select-ai/.well-known/agent-card.json`
- JSON-RPC endpoint: `https://YOUR_PUBLIC_AGENT_HOST/select-ai`

What it does today:

- it now calls `DBMS_CLOUD_AI.GENERATE` through the live `YOUR_SELECT_AI_PROFILE_NAME` profile on the demo database
- if the profile becomes unavailable, it falls back honestly through deterministic SQL summaries over the demo tables
- it uses a generic schema-aware prompt over the profiled objects, so it is no longer limited to one stockout-summary question
- it supports question styles such as `narrate`, `showsql`, and `explainsql`

Recommended Gemini Enterprise prompt:

```text
Which products are at risk of stockouts next quarter, and which regions are driving that risk?
```

Other example prompts:

```text
For SKU-700, which warehouse has the lowest coverage days and what hotspot score and revenue impact does it have?
```

```text
What is the projected revenue impact for each product in the current quarter?
```

```text
Show SQL for the warehouse hotspot metrics for SKU-500.
```

Current expected response shape:

- plain-text summary of the highest-risk products
- plain-text regional-driver detail for the requested or inferred SKU
- metadata showing `executionMode=select-ai`
- metadata showing `sourceDetail=DBMS_CLOUD_AI.GENERATE via profile YOUR_SELECT_AI_PROFILE_NAME`

## Inventory-System Gateway

The same Java process now also serves an inventory-system gateway at:

- card alias: `https://YOUR_PUBLIC_AGENT_HOST/agent-card-inventory-system.json`
- dedicated card path: `https://YOUR_PUBLIC_AGENT_HOST/inventory-system/.well-known/agent-card.json`
- JSON-RPC endpoint: `https://YOUR_PUBLIC_AGENT_HOST/inventory-system`

What it does today:

- routes graph-style requests such as dependency, upstream, downstream, supplier, or property-graph questions to the local Oracle graph agent
- routes map-style requests such as hotspot, county, latitude, longitude, or spatial questions to the local Oracle spatial agent
- routes action prompts such as transfer, next move, or actions to take to the local inventory-action coordinator
- routes everything else to the Oracle-hosted Oracle AI Database Agent over A2A JSON-RPC
- constrains stockout and inventory-risk database prompts to the `SALES_USER.SC_INVENTORY_RISK_*` demo objects and uses `SKU-500` as the default product focus
- passes through remote database artifacts when the Oracle AI Database Agent returns them, so HTML charts and images can flow back through the gateway
- surfaces remote Oracle AI Database delegation failures by default; set `INVENTORY_SYSTEM_ALLOW_LOCAL_SELECT_AI_FALLBACK=true` only for an explicit local demo fallback

Environment knobs for the remote database handoff:

- `ORACLE_AI_DATABASE_AGENT_URL`: override the default Oracle-hosted JSON-RPC endpoint
- `ORACLE_AI_DATABASE_AGENT_BEARER_TOKEN`: optional bearer token for the remote delegate call
- `ORACLE_AI_DATABASE_AGENT_AUTHORIZATION_HEADER`: optional full authorization header, if you need something other than `Bearer ...`
- `ORACLE_AI_DATABASE_AGENT_TIMEOUT_SECONDS`: override the remote request timeout
- `INVENTORY_SYSTEM_ALLOW_LOCAL_SELECT_AI_FALLBACK`: defaults to disabled; set to `true` only when local Select AI fallback is acceptable

Recommended Gemini Enterprise prompt:

```text
Which products are at risk of stockouts next quarter, and which regions are driving that risk?
```

Graph-routing prompt:

```text
Show the supply chain dependency graph for SKU-500 and explain the active alert.
```

Spatial-routing prompt:

```text
Show that on a map for SKU-500 and highlight the warehouse hotspots.
```

Chart-style prompt:

```text
Create a chart of projected revenue impact by region for the current quarter.
```

Local test script:

```bash
./test_inventory_system.sh
./test_inventory_system.sh "Show the supply chain dependency graph for SKU-500 and explain the active alert."
GRAPH_AGENT_URL="https://YOUR_PUBLIC_AGENT_HOST" ./test_inventory_system.sh
```

Expected response shape:

- plain-text summary for every route
- PNG artifacts for graph or spatial requests
- HTML or image artifacts when the remote Oracle AI Database Agent returns charts
- metadata showing `delegatedTo=oracle-ai-database-agent`, `oracle-ai-database-agent-error`, `graph`, `spatial`, `inventory-action`, or `select-ai-fallback` when that optional fallback is explicitly enabled

## Inventory Action Coordinator

Recommended Gemini Enterprise prompt:

```text
What inventory action should we take for SKU-500 given the current supply risk? Gather graph, spatial, and external evidence first, then recommend the safest next move and say whether approval is required.
```

More explicit transfer-oriented prompt:

```text
For SKU-500, gather the supporting graph, spatial, and external evidence, then tell me whether we should shift inventory between warehouses. If a transfer is appropriate, draft the move but do not execute it.
```

Local test script:

```bash
./test_inventory_action.sh
./test_inventory_action.sh "What inventory action should we take for SKU-500 given the current supply risk?"
GRAPH_AGENT_URL="https://YOUR_PUBLIC_AGENT_HOST" ./test_inventory_action.sh
```

Expected response shape:

- evidence-backed recommendation in plain text
- explicit approval status
- if a transfer was drafted, the source warehouse, destination warehouse, units, and draft action id

## What Success Looks Like

When `./test.sh` succeeds, discovery should show:

- `name: oracle_graph_agent`
- `defaultOutputModes: ["image/png", "text/plain"]`
- `url: http://localhost:8081` for local dev, or your public `https://` URL when deployed

The action response should show:

- `status: completed`
- one artifact named `supply_chain_graph_png`
- one file part with `mimeType: image/png`
- one text status message summarizing the dependency chain

Example summarized action output:

```json
{
  "status": "completed",
  "artifacts": [
    {
      "name": "supply_chain_graph_png",
      "parts": [
        {
          "kind": "file",
          "mimeType": "image/png",
          "name": "supply-chain-graph.png"
        }
      ]
    }
  ],
  "statusMessageParts": [
    {
      "kind": "text",
      "text": "Dependencies for SKU-500: Supplier: Global Logistics -> Product: SKU-500 | relationships: SUPPLIES"
    }
  ]
}
```

## Moving This Directory

If you move this agent under another repo:

- keep the shared `.env` one directory above this folder, or update `run.sh` and `test.sh`
- keep `GRAPH_AGENT_PORT` defined in that new parent `.env`
- rebuild after the move with `./build.sh`

## Notes

- `run.sh` reads the shared repo `.env` and starts the Spring Boot app on `GRAPH_AGENT_PORT`.
- If `SSL_CERTIFICATE` and `SSL_CERTIFICATE_PRIVATE_KEY` are set, `run.sh` starts the same Spring Boot app with HTTPS enabled.
- `test.sh` reads the same `.env` and targets `GRAPH_AGENT_URL` or a URL derived from `PUBLIC_HOST`, `PUBLIC_PROTOCOL`, and `GRAPH_AGENT_PORT`.
- `test.sh` now persists returned file artifacts under `test-output/` and prints the saved file path.
- The JSON-RPC test uses the standard A2A `message/send` method at the root `/` endpoint and summarizes returned artifacts without printing the embedded base64 PNG.
- The current response model is: PNG artifact first, text summary second.
- The graph agent now supports `GRAPH_DATA_MODE=database|payload|auto`. In `database` mode it queries the seeded Oracle Property Graph directly; in `payload` mode it renders a validated upstream JSON payload; in `auto` mode it prefers payload and falls back to the database.
- The graph agent still renders its output with custom Java2D code, not a separate graph-visualization library.
- The spatial agent uses JTS for geometry handling and Java2D for final rendering.
- `GraphTools.getSupplyChainDependencies()` now owns both the Oracle query path and the validated payload path.
- The inventory-action coordinator uses Google ADK Java in-process. It currently mixes one live Oracle graph tool, one live in-process spatial tool, and seeded external evidence while we keep the overall demo in a single convenient JVM.
- The inventory-action coordinator is ADK-first, but it now has a deterministic fallback so the demo still returns a recommendation when remote Vertex credentials are missing or expired.
- For wallet-backed Oracle Database access, the Maven config now imports Oracle's `ojdbc-bom`, pins Spring Boot's managed Oracle version to `23.3.0.23.09`, and includes `oraclepki` alongside `ojdbc11`. Older 19c/21c examples in this repo use `osdt_core` and `osdt_cert`, but Oracle's 23ai guidance says wallet support on 23ai only requires `oraclepki`, and the `23.3.0.23.09` `osdt_*` artifacts are not published on Maven Central.
- Self-signed certificates are a poor fit for Gemini Enterprise because the Google-managed caller must trust the certificate chain. Use a publicly trusted certificate instead.
