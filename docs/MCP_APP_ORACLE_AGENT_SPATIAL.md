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

The feature list is populated from the live response. A placeholder `[0, 0]`
route is rejected. A relief route is rendered only when the agent returns a
real route or both source and destination coordinates in the same response.

The selector is not hard-coded to `SKU-500`; other SKUs are passed through to
the managed agent. If the managed agent cannot return valid evidence for a
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
`oracle-ai-database-agent` as its source. The transfer dashboard remains
Toolkit-backed and read-only unless its separately governed write flow is
explicitly enabled.

The public `dataaccess.adb.../adb/a2a/v1/agents/...` URL is not the private
database route used by this deployment and may return an ACL-hidden 404. The
runtime endpoint is the private relay URL, which forwards the caller/service
OAuth bearer token to the database-private A2A endpoint.
