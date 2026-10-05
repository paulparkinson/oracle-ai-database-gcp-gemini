# Managed Oracle property graph → Cytoscape.js MCP App

`show-supply-chain-graph` accepts **only a SKU**, obtains fresh evidence through
the managed Oracle AI Database Agent, and renders a bundled interactive
Cytoscape.js graph. It does not generate a picture or accept Gemini-supplied
nodes, edges or source claims.

```text
Gemini Enterprise → existing Oracle Supply-Chain MCP App connector
  → show-supply-chain-graph(sku) → Java gateway
    → server-side OAuth → managed Oracle AI Database Agent via A2A/private relay
      → SC_SUPPLY_CHAIN_GRAPH_V → GRAPH_TABLE / MATCH on SUPPLY_CHAIN_GRAPH
        → validated rows → typed nodes/edges → Cytoscape.js MCP App
```

## Database graph and query

The query is SQL/PGQ over the **property graph**, not joins over its backing
tables. The graph is defined in [setup_supply_chain_graph_schema.sql](../sql/setup_supply_chain_graph_schema.sql).
The fixed graph traversal is in
[create_managed_agent_graph_view.sql](../sql/create_managed_agent_graph_view.sql).
The managed agent reads that Oracle view using
[OracleGraphEvidenceService.query()](../oracle_agent_java/src/main/java/oracleai/OracleGraphEvidenceService.java).
The view is not cached/materialized: Oracle evaluates the graph at query time.

It matches two patterns:

- Active supplier → plant → port → warehouse → product, using current
  SUPPLIES, SHIPS_VIA, ROUTES_TO and STOCKS edges.
- The same path plus an active alert → port AFFECTS edge.

`UNION ALL` retains paths without alerts without requiring `OPTIONAL MATCH`.
A path with an alert appears in both branches; `pathRows` counts returned
rows, not unique paths. The UI deduplicates nodes and typed relationships.
The query retains every PRODUCT_ID; Java selects the requested SKU.

The managed agent is asked to return view rows and report its query tool's
`sql_query` as single-line `executedSql`. The gateway rejects missing/different SQL,
including join-based rewrites. Whitespace, unquoted letter case, uppercase
identifier quoting, identity-preserving table/column aliases and a terminal
semicolon are normalized; literal values are preserved. **This comparison is
an agent-report check, not a signed Oracle execution receipt.**

Other validation boundaries:

- Database IDs and names are preserved; edge IDs are stable UI relationship
  keys, not Oracle edge-table primary keys.
- Conflicting identities, missing fields/task IDs and invalid JSON fail closed.
- At 1,000 rows the response is rejected because the upstream SQL tool caps
  results at 1,000. Display limits are 500 nodes and 1,000 edges.
- NO_DATA means no complete active path returned for that SKU, not no product,
  a safe supply chain or continuous monitoring.
- Reads query seeded Oracle demo data at request time, not production telemetry.
- No Toolkit, direct JDBC, relational-join, static-data or host-payload fallback.

## Configure the managed agent

Use SQLcl on the existing GCP VM/private network as the application schema
owner. First inspect the **actual active profile**, which can differ from
`.env` or an older setup script:

```sql
SELECT value AS active_profile
FROM selectai_agent_config
WHERE agent = 'ORACLE_AI_DATABASE_AGENT' AND key = 'AGENT_AI_PROFILE';

SELECT object_name, object_type, status
FROM user_objects
WHERE object_name = 'SUPPLY_CHAIN_GRAPH';

SELECT profile_name, attribute_name, attribute_value
FROM user_cloud_ai_profile_attributes
WHERE profile_name = (
  SELECT value FROM selectai_agent_config
  WHERE agent = 'ORACLE_AI_DATABASE_AGENT' AND key = 'AGENT_AI_PROFILE')
AND attribute_name IN ('object_list', 'model', 'provider');
```

The graph must be VALID. **Do not add it directly to the shared table/view
profile:** Oracle rejects mixed property-graph and table/view object lists
with ORA-20000. Instead, expose the narrowly scoped graph-backed view through
the existing SQL tool. This preserves catalog/spatial reads without switching
profiles between concurrent requests. A separate graph-only Select AI profile
is another supported pattern, but is not used by this implementation.

With authorization, run from the application checkout on the GCP VM:

```sql
@sql/create_managed_agent_graph_view.sql
@sql/enable_managed_agent_graph_view.sql
```

The first script creates FINANCIAL.SC_SUPPLY_CHAIN_GRAPH_V and deliberately
refuses to replace an existing object; if already installed, verify its
USER_VIEWS definition rather than rerunning CREATE. The second idempotently
adds only that view to the active profile, preserving existing entries,
profile selection, model and credentials. Capture its printed previous list
in a protected operator log outside Git. Neither script modifies inventory,
replaces the graph or grants new user privileges.

For rollback, first restore the previous application revisions, then use
`DBMS_CLOUD_AI.SET_ATTRIBUTE` to restore the captured `object_list` on the
captured profile. Check for intervening configuration changes before restoring;
do not overwrite another administrator's additions. The unused read-only view
can remain after rollback; removing it is a separate, explicitly scoped DDL action.

## Use in Gemini Enterprise

1. Deploy the gateway and MCP server, then open the existing **Oracle
   Supply-Chain MCP App → Actions** in the GCP console.
2. Choose **Reload custom actions**, enable **Show-supply-chain-graph**
   alongside catalog/spatial actions, and start a fresh chat. No second
   connector or separate graph OAuth client is required.
3. Try:

| Prompt | Check |
| --- | --- |
| `Use List-inventory-items to list the managed Oracle inventory catalog and its scope.` | Discover current IDs; catalog membership alone does not imply a graph path. |
| `Use Show-supply-chain-graph for SKU-500.` | Interactive graph, not a generated PNG. |
| `Use Show-supply-chain-graph for SKU-700. Explain only returned relationships.` | Different product/path; inspect supplier and alert IDs. |
| `Use Show-supply-chain-graph for SKU-900.` | Fresh task ID and product-specific nodes. |
| `Use Show-supply-chain-graph for SKU-501. Do not substitute another product.` | NO_DATA if no complete active path exists. |

Click nodes/edges for details, drag nodes, pan/zoom, change layout, search by
name/ID/type, and choose **Fit graph**. These are view operations; ask again
for another Oracle read.

![Cytoscape.js graph inside Gemini Enterprise.](images/gemini-cytoscape-sku700.jpg)

The screenshot illustrates the interactive UI; it is not proof of which SQL
executed. Use the checks below for query provenance.

## Build, deploy and test the GCP services

The [managed-read runbook](MCP_APP_ORACLE_AGENT_SPATIAL.md) covers the existing
OAuth secrets, private relay, gateway configuration and token renewal. The
graph uses the same configured gateway origin and Oracle identity as the map.

From the application checkout:

```bash
cd oracle_agent_java
mvn clean test package
cd ../mcp-app
npm ci --ignore-scripts
npm run typecheck
npm run build
node --import tsx --test test/graph-contract.test.mjs test/concurrent-requests.test.mjs
cd ..
./deploy/gcp/deploy-oracle-agent-and-mcp-app.sh
```

Use Java 21 and Node.js 20.19+ or 22.12+. Deployment requires authorization and
updates the existing Cloud Run services; it does not execute database writes.
The script prints the gateway and MCP service URLs. Test those HTTPS services:

```bash
export GATEWAY_URL='https://YOUR_GATEWAY_SERVICE'
export MCP_URL='https://YOUR_MCP_SERVICE/mcp'
curl --fail-with-body --max-time 150 \
  "$GATEWAY_URL/api/inventory/supply-chain-graph?sku=SKU-700"
node mcp-app/test/graph-ui.mjs "$MCP_URL" SKU-700 /tmp/graph-sku700.png
node mcp-app/test/graph-ui.mjs "$MCP_URL" SKU-900
node mcp-app/test/graph-ui.mjs "$MCP_URL" SKU-501 /tmp/graph-no-data.png
node mcp-app/test/live-evidence.mjs "$MCP_URL"
```

Java/contract tests use fixtures. The browser test fetches real MCP evidence
and the bundled resource from the deployed service, then checks interaction
in an isolated protocol test harness. It does not replace a Gemini host test.
Cytoscape requires no CDN/API key or external network access for rendering.

## Verify the source and actual query

1. Expand Gemini's trace: expect **Show-supply-chain-graph**. Disable Google
   Search for an isolated test. Skill loading and narration do not query Oracle.
2. Record the deployed revision, request time, SKU, scope, A2A task ID, node IDs,
   requested `query`, agent-reported `executedSql` and Oracle `contextId`. The gateway authenticates
   its call to the managed Oracle agent; Gemini only supplies the SKU.
3. Independently execute the canonical read-only GRAPH_TABLE query through an
   authorized SQLcl session on the GCP VM and compare returned IDs/relationships.
4. Correlate `contextId` with `USER_AI_AGENT_TEAM_HISTORY.CONVERSATION_ID`,
   then use its `TEAM_EXEC_ID` to inspect `USER_AI_AGENT_TOOL_HISTORY.OUTPUT`
   for `SQL_TOOL`. The nested JSON `result` contains `sql_query` and `sql_result`.
   Confirm successful view SQL and the actual returned IDs; `status=success`
   alone can wrap an error. Verify `USER_VIEWS.TEXT` contains the canonical
   GRAPH_TABLE/MATCH definition. Use the read-only
   [verification script](../sql/verify_managed_graph_read.sql).
   A task ID is not the Oracle team execution ID. These Oracle-side records
   independently establish this path; they are not a cryptographic attestation.

Authentication, query, response-validation and host errors must remain errors,
not NO_DATA or substitute graphs. A 502 alone does not diagnose a database outage.

## Validation record

On October 4, 2026, an independent FINANCIAL connection verified the existing
SUPPLY_CHAIN_GRAPH was VALID. The canonical GRAPH_TABLE/MATCH query returned
six rows (base path plus alert path for SKU-500, SKU-700 and SKU-900).
The active profile was PAULPARK_SUPPLY_CHAIN_GEMINI37_TRIAL. An authorized
attempt to append the direct graph failed Oracle's mixed-object restriction;
that addition was immediately rolled back, restoring the original 15 entries.
With subsequent authorization, SC_SUPPLY_CHAIN_GRAPH_V was created and added
as the 16th profile entry. Both graph and view are VALID; the existing 15
entries, Google provider and gemini-3.7-flash model were preserved.

The predeployment SKU-900 request returned six nodes, five typed edges and two
path rows (task `cb641e12-2f5c-4087-9e54-5ae7e606fbc1`). Its Oracle context
`5C71F7E4-2AC0-2EE1-E063-6914000A6D81` matched team execution
`5C71F7E4-2AC1-2EE1-E063-6914000A6D81` at 23:48:23 UTC. Independent SQLcl
inspection found successful SQL_TOOL output selecting the view and all six
database rows; the SKU-900 IDs and relationships agreed with the gateway.
The agent normalized its reported SQL rather than preserving the exact
Oracle tool formatting/aliases, which is why the independent history matters.

Deployed revisions `oracle-inventory-agent-gateway-00006-fk2` and
`oracle-supply-chain-mcp-gemini-00036-wlm` serve this implementation. The existing
Gemini connector's three actions were reloaded; no new connector was created.
Sixteen Java tests and three MCP contract/concurrency tests passed. Deployed
catalog/spatial regression checks passed, as did interactive graph tests for
SKU-700 and SKU-900 (six nodes/five edges each), and SKU-501 (NO_DATA).

The actual Gemini SKU-700 host test, pictured above, returned task
`c32dedc8-6fb4-4ab9-9d5a-d30828996402` and context
`5C71F7E4-2B19-2EE1-E063-6914000A6D81`. An independent Oracle session matched
that context to successful team execution `5C71F7E4-2B1A-2EE1-E063-6914000A6D81`
at 23:55:36 UTC on October 4. Its SQL_TOOL output selected the graph-backed
view and returned the matching Atlas Components/Austin Assembly/Savannah/DFW
Hub/Low Carbon Kit 700/Customs Hold IDs. This verifies the host request against
Oracle-side history, rather than trusting Gemini narration or a source label.

## Architecture and scope

For transfer recommendations use the separate **Oracle Supply-Chain A2UI**
Gemini agent, whose Toolkit-backed review/approval flow is described in the
[two-lane demo](INVENTORY_UI_ARCHITECTURE.md). The older Java inventory-action
coordinator is draft-only. Exploration remains read-only. The legacy `/graph` A2A
image/payload examples are separate compatibility code and are never called by
this MCP action. The obsolete spatial Java2D/JTS generator was removed.

Secrets and refresh grants stay server-side. Stored-grant identity is not
automatic per-Gemini-user delegation. Public demo ingress and existing
dependency advisories still require review before production deployment.
