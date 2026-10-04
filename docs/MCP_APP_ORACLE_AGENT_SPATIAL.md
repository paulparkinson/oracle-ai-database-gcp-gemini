# MCP App spatial reads from the managed Oracle AI Database Agent

This implementation intentionally separates read and write authority:

```text
Gemini Enterprise
  -> Oracle Supply Chain MCP App: show-inventory-spatial-hotspots(sku)
  -> Java gateway: /api/inventory/spatial-hotspots
  -> private Oracle A2A relay
  -> managed Oracle AI Database Agent
  -> schema-validated hotspot JSON
  -> GeoJSON and MapLibre UI

A2UI transfer review
  -> Oracle Database MCP Java Toolkit
  -> explicit approval/write path
```

The MCP spatial tool does not accept an `oracleAgentEvidence` argument. That
would allow the host model to supply unverified coordinates. It accepts only a
SKU, asks the Java gateway to call the managed agent, and renders only the
validated response. There is no spatial fallback to static data, Select AI, or
the MCP Toolkit. A failed managed-agent call is surfaced as an error.

## Local verification

Build the Java gateway and MCP App:

```bash
cd oracle_agent_java
mvn -q test
mvn -q -DskipTests package
cd ../mcp-app
npm ci --ignore-scripts
npm run typecheck
npm run build
```

For an end-to-end test, run the Java gateway with a temporary bearer token or
the three runtime secret variables, pointing
`ORACLE_AI_DATABASE_AGENT_URL` at the private relay. Then start the MCP App
with:

```bash
ORACLE_SPATIAL_EVIDENCE_URL=http://127.0.0.1:18090/api/inventory/spatial-hotspots \
PORT=13001 MCP_BIND_HOST=127.0.0.1 \
node --import tsx server.ts
```

Invoke `show-inventory-spatial-hotspots` with `{ "sku": "SKU-500" }`. The
structured result must contain:

```json
{
  "source": "oracle-ai-database-agent",
  "sku": "SKU-500",
  "geojson": { "type": "FeatureCollection", "features": [] }
}
```

The gateway requests explicit database rows, preserving `PRODUCT_ID` and
`WAREHOUSE_ID`, then filters by product in Java. It rejects conflicting rows,
invalid coordinates and scores outside 0–1. It draws a schematic line only
when exactly one source and one destination are present; this is not road
routing or a transfer recommendation. Relay/satellite warehouses are purple.

The selector accepts alphanumeric, hyphenated and underscored SKUs. The managed
agent queries the scoped view and Java filters its returned rows by SKU.
If the managed agent cannot return valid evidence for a
SKU, the gateway fails closed rather than substituting demo data.

## Cloud Run deployment

The repository-root `.env` is for local work only. Do not commit the OAuth
client, secret, refresh token, wallet, or generated build output. The deploy
script references these Secret Manager secrets:

- `oracle-agent-paulparkdb-oauth-client-id`
- `oracle-agent-paulparkdb-oauth-client-secret`
- `oracle-agent-paulparkdb-oauth-refresh-token`

Deploy the Java gateway and then the existing MCP App service:

```bash
./deploy/gcp/deploy-oracle-agent-and-mcp-app.sh
```

After deployment, verify the MCP App service health and then invoke the
existing **Oracle Supply Chain MCP App** connector action
`show-inventory-spatial-hotspots` in Gemini Enterprise. The UI should show
`oracle-ai-database-agent` as its source. In read-only deployment, the same
connector now advertises `show-inventory-spatial-hotspots` and
`list-inventory-items`, not the Toolkit transfer dashboard. Reload custom
actions on the existing connector and start a fresh conversation after changing
the tool list. Transfer approval remains in the separate A2UI/Toolkit path.

## Evidence correctness and interpretation

The earlier three-Newark-row result for SKU-500 was incorrect: scores 0.29 and
0.28 belonged to SKU-700 and SKU-900. Validating only an outer `sku` field
did not detect that mix-up. The corrected row contract retains each product ID.

The October 4 managed-agent SQL audit returned these products from
`FINANCIAL.SC_PRODUCTS`: SKU-500, SKU-700, SKU-900, SKU-APAC-210 and SKU-APAC-420.
This is a scoped demo catalog, not every inventory table. The Toolkit's
`SUPPLY_PRODUCTS` dataset is separate; its recommendations are neither a
complete catalog nor evidence for the managed-agent spatial view.

Try these prompts in a fresh Gemini Enterprise conversation:

- “Use List-inventory-items to list the managed Oracle inventory catalog and its scope.”
- “Show the spatial hotspot map for SKU-700.”
- “Show the spatial hotspot map for SKU-APAC-210.”
- “Show the spatial hotspot map for SKU-501. If there are no rows, report risk as unknown.”

`NO_DATA` means no matching rows were returned from
`FINANCIAL.SC_INVENTORY_RISK_DEMO_V`. It does not mean stable inventory, zero
risk, absence from all tables, or ongoing monitoring. A failed call is an
upstream/validation error, not proof of missing spatial profiles. GRID-CTRL
previously failed because our Java SKU validator rejected it—not because Oracle
Spatial was down. It is now valid input, even if this view has no matching rows.

`HOTSPOT_SCORE` is a 0–1 score, not a probability. Do not turn 0.86 into “86%
stockout probability,” invent quantities, or promise monitoring. The UI displays
the query scope and A2A task ID. These identify the authenticated managed-agent
request; they are not a database-signed attestation that an LLM executed the
exact requested SQL. Independent row-level proof requires correlating that
task with Oracle-side query/audit records. Schema validation alone is not proof.

Regression checks:

```bash
cd oracle_agent_java
mvn test
cd ../mcp-app
npm run typecheck
npm run build
node --test test/concurrent-requests.test.mjs
node test/live-evidence.mjs https://YOUR_MCP_SERVICE/mcp
```

The live check makes read-only managed-agent requests and does not execute
inventory transfers. It checks catalog scope, per-row SKU identity, task IDs,
the absence of Toolkit tools, positive SKUs and explicit no-data cases.

The public `dataaccess.adb.../adb/a2a/v1/agents/...` URL is not the private
database route used by this deployment and may return an ACL-hidden 404. The
runtime endpoint is the private relay URL, which forwards the caller/service
OAuth bearer token to the database-private A2A endpoint.

## OAuth renewal and October 4 validation

The gateway automatically exchanges its refresh token for an access token and
caches that access token until shortly before expiry. Interactive consent is
not required for each map request. Local `gcloud auth login` is for deployment
and log access; it is not part of the deployed application's authentication.

On October 4, 2026, the gateway logs showed the Oracle token endpoint rejecting
the previous refresh grant with HTTP 401 / `ADB-00015`. That response does not
establish whether the grant expired or was revoked. A new browser consent
completed using the existing client. Two subsequent refresh requests succeeded
without additional consent; neither returned a replacement refresh token.
Do not describe this incident as proven refresh-token rotation or promise that
the new grant has an unlimited lifetime. The current Java client does not
persist replacement refresh tokens if a provider later starts returning them.

The renewed grant is stored in the existing Secret Manager secret. Updating an
environment-variable secret requires a new Cloud Run revision for running
instances to receive it. Tests of the deployed MCP action returned three
hotspots for `SKU-500` and an empty hotspot list for `SKU-501`. An empty list
means the managed agent supplied no spatial evidence for that request; it is
not an authentication failure and does not prove the SKU is absent from every
database table.

The MCP server creates a separate protocol instance for each stateless HTTP
request. Verify concurrent calls locally with:

```bash
cd mcp-app
npm run typecheck
node --test test/concurrent-requests.test.mjs
```

This regression test uses a delayed local test server, not live database data.

### Corrected v6 endpoint validation (October 4, 2026)

Deployed gateway revision `oracle-inventory-agent-gateway-00003-rxx` and MCP
revision `oracle-supply-chain-mcp-gemini-00034-p2w`. Existing OAuth secret
references and wallet mounts were preserved; no new consent was required.

Seven Java unit tests, TypeScript typechecking/build, and the concurrent MCP
regression test passed. The live public MCP endpoint returned:

| Request | Result | Oracle A2A task |
| --- | --- | --- |
| Catalog | Five SC_PRODUCTS products | 45c2b929-c671-4fed-858a-64f7de97beb3 |
| SKU-500 | Newark 0.86, DFW 0.31, Chicago 0.48 | e6b9847b-bf3d-42e5-b1c6-8e3018d56fee |
| SKU-700 | Chicago 0.74, DFW 0.36, Newark 0.29 | f81812c8-2938-499c-86f0-5c666c906981 |
| SKU-APAC-210 | Singapore 0.91, Sydney 0.44 | 707c9079-aff9-4b54-8d2a-de368498a027 |
| SKU-501 | NO_DATA; risk unknown | 0bc506e7-b251-47ab-ba7c-fb65b7bbff1f |
| GRID-CTRL | NO_DATA; no HTTP 500 | d47c7da5-4ab8-4505-a779-6c8f088ada45 |

These are observed results, not hardcoded production responses. The live
regression script assumes this demo catalog; update its expectations if seed
data changes. The earlier three-hotspot count alone was insufficient validation;
v6 checks each row's product identity and preserves warehouse IDs.
