# MCP App spatial reads from the managed Oracle AI Database Agent

This implementation intentionally separates read and write authority:

```text
Gemini Enterprise
  -> MCP App server: show-inventory-spatial-hotspots(sku)
    -> Java gateway: /api/inventory/spatial-hotspots
      -> OAuth token exchange (or reuse a still-valid cached access token)
        -> Oracle AI Database Agent via A2A (through the private relay)
          -> validated spatial JSON
            -> GeoJSON -> MapLibre MCP App

Oracle Supply-Chain A2UI agent (separate GCP service)
  -> governed Toolkit recommendations -> native A2UI review
  -> explicit approval -> Oracle Database MCP Java Toolkit write operation
```

The MCP spatial tool does not accept an `oracleAgentEvidence` argument. That
would allow the host model to supply unverified coordinates. It accepts a
SKU and optional display-row limit, asks the Java gateway to call the managed
agent, and renders only the validated response. There is no spatial fallback to static data, Select AI, or
the MCP Toolkit. A failed managed-agent call is surfaced as an error.

The [two-lane runbook](INVENTORY_UI_ARCHITECTURE.md) identifies the tested
**Oracle Supply-Chain A2UI** agent. Do not confuse it with the older draft-only
Java inventory-action coordinator. Recommendation rendering was tested without
approving or executing a transfer.

The data is **live database-backed reads of seeded demo data**, not production
inventory telemetry. The SQL setup/seed files populate Oracle tables; they are
not a frontend mock response. Both the US and Singapore/Sydney warehouse rows
belong to this seeded dataset. “Live” describes querying Oracle at request time;
“seeded” describes how the demonstration data was initially populated.
The read path does not itself query Google Search.
Gemini's surrounding narration is not evidence of any database operation.

## Run it in Gemini Enterprise

Use the existing **Oracle Supply-Chain MCP App** connector, with both
**List-inventory-items** and **Show-inventory-spatial-hotspots** enabled.
These are two actions on one connector, not two new connectors. The same
connector now also supports the [Cytoscape graph action](MCP_APP_ORACLE_AGENT_GRAPH.md);
its runbook includes the updated three-action screenshot. After a tool
schema change, reload custom actions and start a fresh conversation. No reload,
deployment, or OAuth consent is normally needed merely to choose another SKU.

![Existing Oracle Supply-Chain MCP App connector with catalog and spatial actions enabled.](images/managed-agent-actions-enabled.jpg)

*Actual connector configuration, October 4, 2026. The read-only deployment
does not advertise the Toolkit transfer dashboard.*

The tools are parameterized; there is no special phrase required. Use a SKU
returned by the catalog. These are example prompts, not a promise that every
host will choose the correct tool from every wording:

| Ask Gemini | What to check |
| --- | --- |
| List the product IDs and names in the managed Oracle inventory catalog, and show the query scope. | `List-inventory-items`; scope `FINANCIAL.SC_PRODUCTS`. |
| Show the spatial hotspot map for SKU-700. | Chicago destination, DFW source, Newark satellite in the verified demo dataset. |
| Show the spatial hotspot map for SKU-APAC-210. | Singapore destination and Sydney source, instead of SKU-700's US warehouses. Both SKUs use the same seeded Oracle dataset. |
| Use Show-inventory-spatial-hotspots for SKU-900, and summarize only the returned warehouse roles and hotspot scores. | Per-row SKU-900 identity; scores are not probabilities. |
| Map SKU-APAC-420, then map SKU-APAC-210 so I can compare them. | Two spatial calls; each map retains its own SKU and returned rows. |
| Show SKU-700 with maximumRows set to 2. | Display limit only; inspect `totalRows` and `truncated`. |
| Show the spatial hotspot map for SKU-501. If no rows are returned, say risk is unknown. | `NO_DATA`, not a fabricated map or a claim of safety. |
| Query SKU-700 again and show the new result's task ID and scope. | A new server request, not a promise of continuous monitoring. |

Catalog, SKU-700 and SKU-501 were tested in the deployed workflow; live endpoint
checks also covered SKU-500 and SKU-APAC-210. Other examples use the same bounded
contract. Discover current products rather than assuming the dated seed values
below never change. Natural-language catalog filtering is a host-side summary;
the catalog tool has no filter arguments. The spatial tool takes one `sku` and
optional `maximumRows` (2–50, default 20), not arbitrary SQL or coordinates.

![Live SKU-700 map in Gemini Enterprise with DFW source, Chicago destination, Newark satellite and a schematic connection.](images/managed-agent-sku700-v6.jpg)

*Actual v6 host test. Pan/zoom preserves geographic positions; click DFW to see
its warehouse details. Map interactions inspect returned data; they do not
query Oracle again. The blue line is a schematic connection, not road routing
or an approved transfer.*

## Why the Java gateway exists

This is a bounded adapter in the existing Java/Spring Boot runtime, not a new
database or a replacement Oracle agent. It exposes two read endpoints:
`GET /api/inventory/catalog` and
`GET /api/inventory/spatial-hotspots?sku=SKU-700`.

The MCP server calls it; the gateway authenticates to the managed Oracle agent
and asks that agent to execute a fixed read-only query. Java validates the
returned product/warehouse identities, coordinates, scores and roles before
the MCP server creates GeoJSON. The scoped spatial query returns rows across
products and Java filters them by the requested SKU. Queries are bounded at
1,001 rows and reject more than 1,000; this is not a paginated large-catalog API.

Keeping this work server-side gives one place for OAuth renewal, timeouts,
validation and fail-closed behavior, reusable across UI hosts. Client ID,
client secret and refresh token come from server configuration/Secret Manager;
the browser iframe receives none of them. It also avoids making the iframe
responsible for Oracle token-endpoint access or holding a long-lived refresh
grant. Initial interactive Oracle consent still legitimately happens in a
browser. Java is convenient because this runtime already exists; the same
boundary could be implemented securely in another server language.

The current deployment uses the identity associated with its stored Oracle
consent grant; it does **not** automatically delegate each Gemini user's
identity. The deployment script permits unauthenticated Cloud Run ingress for
this demo. Upstream OAuth alone does not make those HTTP endpoints private.
Before production, protect ingress/service-to-service calls, decide per-user
versus explicitly authorized service access, apply least privilege, and handle
refresh-token rotation/revocation. See the renewal limitations below.

## Local verification

Use Java 21/Maven and Node.js 20.19+ or 22.12+. Build checks do not establish
live Oracle connectivity. From the repository root, build both components:

```bash
cd oracle_agent_java
mvn -q test
mvn -q -DskipTests package
cd ../mcp-app
npm ci --ignore-scripts
npm run typecheck
npm run build
```

For an end-to-end test, configure the repository-root ignored `.env` with
`ORACLE_AI_DATABASE_AGENT_URL` (the reachable private relay),
`ORACLE_AI_DATABASE_AGENT_TOKEN_URL`, `ORACLE_AI_DATABASE_AGENT_CLIENT_ID`,
`ORACLE_AI_DATABASE_AGENT_CLIENT_SECRET`, `ORACLE_AI_DATABASE_AGENT_REFRESH_TOKEN`
and `INVENTORY_SCHEMA_OWNER=FINANCIAL`. Use the existing consent grant; see
[downstream OAuth setup](../oracle_agent_java/ORACLE_AI_DATABASE_DOWNSTREAM_AGENT.md)
only if registration/consent is missing or rejected. Never paste secrets into
Gemini. Remove stale bearer/authorization-header overrides before testing the
refresh flow; those overrides take precedence in the Java client.

In a separate terminal, from the repository root, start the gateway (HTTP local
example assumes no SSL certificate settings in `.env`):

```bash
GRAPH_AGENT_PORT=18090 BIND_HOST=127.0.0.1 ./oracle_agent_java/run.sh
```

Then, from `mcp-app/`, start the read-only MCP server:

```bash
ORACLE_SPATIAL_EVIDENCE_URL=http://127.0.0.1:18090/api/inventory/spatial-hotspots \
PORT=13001 MCP_BIND_HOST=127.0.0.1 \
MCP_WRITES_ENABLED=false \
node --import tsx server.ts
```

Invoke `show-inventory-spatial-hotspots` with `{ "sku": "SKU-500" }` through an
MCP client connected to `http://127.0.0.1:13001/mcp`. A populated result includes
`source`, `sku`, `status: "DATA"`, `scope`, `taskId`, `hotspots`, and a GeoJSON
FeatureCollection. An empty FeatureCollection is expected only for no data
(example excerpt):

```json
{
  "source": "oracle-ai-database-agent",
  "sku": "SKU-501",
  "status": "NO_DATA",
  "hotspots": [],
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

The October 4 managed-agent query check returned these products from
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

## Verify provenance, not just a working map

Use all three levels below. A source string, `Load Skill`, a green tool check,
or different-looking maps is not independent proof of a database query.

1. **Host trace:** expand the Gemini steps. The catalog/spatial custom actions
   should execute. `Load Skill` only loads instructions; Google Search does
   not query this Oracle view. If Search or the old transfer dashboard appears,
   treat its text as unrelated to the spatial result and inspect the actual
   spatial tool output. Disable Google Search for an isolated demo, start a
   fresh chat, and invoke the named spatial action. The Oracle A2A call happens
   behind that action, so a separate Oracle agent card need not appear in the
   host trace.
2. **Server call and payload:** run the live test directly, outside Gemini:

   ```bash
   # From the repository root; replace with your deployed MCP URL.
   node mcp-app/test/live-evidence.mjs https://YOUR_MCP_SERVICE/mcp
   ```

   For raw gateway evidence, make a read-only request (these examples assume
   the demo's public ingress; use your configured caller authentication if
   ingress is protected):

   ```bash
   curl --fail-with-body --max-time 120 \
     'https://YOUR_GATEWAY_SERVICE/api/inventory/catalog'
   curl --fail-with-body --max-time 120 \
     'https://YOUR_GATEWAY_SERVICE/api/inventory/spatial-hotspots?sku=SKU-700'
   ```

   Preserve request time, service revision, `taskId`, `scope`, requested `query`,
   and returned rows. Check every hotspot's `sku`, `warehouseId`, coordinates,
   role and score—not only the outer SKU or row count. Compare SKU-700 with
   SKU-APAC-210 and a NO_DATA case. Inspect the deployed revision/configuration
   and correlate gateway/relay request logs; never copy token values to logs
   or screenshots. The live script verifies contracts and the remote call
   path; unit/concurrency tests use fixtures and are not database evidence.
3. **Independent Oracle confirmation:** with an authorized read-only SQL
   connection to the same database/schema, compare the returned rows:

   ```sql
   SELECT product_id, product_name
   FROM financial.sc_products
   ORDER BY product_id;

   SELECT product_id, warehouse_id, warehouse_code, warehouse_name,
          latitude, longitude, hotspot_score, recommended_role
   FROM financial.sc_inventory_risk_demo_v
   WHERE product_id = 'SKU-700'
   ORDER BY hotspot_rank;
   ```

   The columns are defined in
   [the schema script](../sql/setup_inventory_risk_demo_schema.sql). Adjust the
   owner only if your deployment uses a different `INVENTORY_SCHEMA_OWNER`.
   To prove the **particular historical execution**, also inspect available
   Oracle agent query diagnostics/database audit records for that time, database
   identity and SQL. An A2A task ID is not a database audit ID; do not assume a
   direct task-ID-to-audit join. The `query` field records requested SQL, not
   an Oracle-signed execution receipt. Matching SELECT results establishes
   content agreement, not by itself that the agent executed that request.

The recorded tests below verified the managed-agent call path and validated
results. They did **not** capture independently correlated Oracle SQL audit
records. If those records are unavailable, report that evidence gap; do not
claim cryptographic or independent execution proof. Do not change demo rows
merely to manufacture proof without separate authorization.

For code review, trace [MCP server](../mcp-app/server.ts) →
[REST controller](../oracle_agent_java/src/main/java/oracleai/OracleSpatialEvidenceController.java) →
[query/validation service](../oracle_agent_java/src/main/java/oracleai/OracleSpatialEvidenceService.java) →
[OAuth/A2A client](../oracle_agent_java/src/main/java/oracleai/OracleAiDatabaseAgentClient.java).
The client performs authenticated A2A `message/send` and task polling; the
spatial handler has no model-supplied-evidence or Toolkit fallback path.

Basemap tiles are a separate presentation dependency. They come from the
configured OpenStreetMap tile service, not Oracle or Google Search. Tile
traffic discloses the requested map area to the provider; keep attribution,
provider permissions and MCP resource CSP/network origins aligned. Tile
success/failure neither proves nor disproves the Oracle data provenance.

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

Gemini Enterprise was also tested in a fresh conversation after reloading the
existing connector's actions. SKU-700 rendered the three warehouses, correct
role colors and DFW–Chicago schematic connection; clicking DFW showed score
0.36. That host run returned task `ff3a3bd1-a5ac-493d-b9f0-3465fc54f92e`.
The simple follow-up “Show the spatial hotspot map for SKU-501” returned
NO_DATA and UNKNOWN risk, with no empty map or Toolkit fallback
(task `e3604580-e52d-4cf1-bd2a-7ce6702e6435`).

The host still used “no spatial profile exists” in a next-step sentence.
That wording goes beyond “no rows returned from this view”; the tool and UI
retain the narrower statement. Do not treat host-generated explanations or
suggested follow-ups as additional database evidence.
