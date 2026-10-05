---
name: inventory-ui-architecture
description: Use, verify, troubleshoot or extend the Oracle inventory demo's managed-agent catalog, MapLibre spatial and Cytoscape.js graph MCP Apps and A2A/A2UI decision lane, including dynamic SKU prompts, provenance checks, Java gateway OAuth boundaries and workshop documentation.
metadata:
  short-description: Maintain the inventory MCP App and A2UI architecture
---

# Inventory UI architecture

Use this skill when changing the Oracle inventory/supply-chain demo, its
workshop, or its agent guidance involving MCP Apps, A2UI, A2A, graph, spatial,
or inventory transfer workflows.

## Required architecture

Work in `oracle-ai-database-gcp-gemini`; workshop content lives in the
`developer/multicloud-gcpagenticai-oracledb` directory. Do not put application
changes in `oracle-ai-for-sustainable-dev`.

Read the [managed read runbook](../../../docs/MCP_APP_ORACLE_AGENT_SPATIAL.md)
for use, OAuth, provenance or spatial work; read the
[two-lane architecture](../../../docs/INVENTORY_UI_ARCHITECTURE.md) for transfer
or UI-protocol changes. For graph work also read the
[graph runbook](../../../docs/MCP_APP_ORACLE_AGENT_GRAPH.md).
Inspect only the implementation relevant to the task.

Maintain two explicit lanes:

- **Explore:** MCP Apps for interactive, primarily read-only graph and spatial
  experiences. The server exposes `list-inventory-items`, `list-inventory-stockout-risks`,
  `show-inventory-spatial-hotspots` and `show-supply-chain-graph`. Reload and
  enable new connector actions after deployment; verify registration separately.
- **Decide and act:** A2A inventory-action coordinator returning A2UI for
  evidence, policy, transfer draft, and approval controls.

Do not describe MCP Apps as the agent orchestrator. An MCP server/tool obtains
the data and the sandboxed `ui://` resource renders it. Do not describe A2UI as
the orchestrator either: the A2A coordinator calls downstream agents/tools and
then emits the declarative UI.

## Safety and truthfulness

For catalog/spatial/graph reads, preserve this path:

```text
Gemini Enterprise → MCP App server → Java gateway
  → OAuth exchange/cache → managed Oracle AI Database Agent via A2A
    → validated rows → MapLibre map / Cytoscape.js graph MCP App
```

Never accept host-model-passed spatial/graph evidence or substitute Toolkit, local Select AI,
Google Search, hardcoded rows or mock results after a failure. Do not “repair”
provenance by changing a source string. Keep client secrets and refresh grants
server-side. Initial browser consent is legitimate; it is not required for
every request while the refresh grant remains valid. Stored-grant identity is
not automatic per-user delegation, and public demo ingress is not production
authorization. Do not promise indefinite token life or implemented rotation.

For a simple stockout-risk question, use the non-visual risk-list action: one
managed-agent read, one compact table, no map/graph fan-out. Preserve its
STOCKOUT_PROBABILITY and quarter; this is not HOTSPOT_SCORE or the Toolkit's
0–100 transfer score. Request graph/map only when the user asks for them.
Ordinary A2UI text requests create a review, never execute a transfer; users
need not append "review only" to every prompt. Execution requires the separate
explicit approval control, not model interpretation of prose.

Use the catalog to discover SKUs, then demonstrate SKU-700 and SKU-APAC-210;
SKU-501 is the dated NO_DATA example. These are live reads of seeded demo
tables, not production telemetry. Do not invent catalog items. `NO_DATA` means
risk unknown in this view, not safety or absence from every table. Preserve
per-row product/warehouse IDs; hotspot scores are 0–1, not probabilities.
Connections are schematic, not optimized routes or transfer recommendations.
Pan/zoom/click inspects a result; a new tool call is needed to query again.
Graph reads use SC_SUPPLY_CHAIN_GRAPH_V, whose Oracle definition executes
GRAPH_TABLE/MATCH on SUPPLY_CHAIN_GRAPH, not joins. A Select AI profile cannot
mix graph objects with table/view objects; expose the graph-backed view in the
shared table/view profile instead. Audit the actual active profile, not just .env.
Request authorization before live schema/profile changes; preserve existing entries,
model and credentials. Reject missing or rewritten agent-reported view SQL. Nodes and edges
must preserve database identity, product scope and typed relationships. The
graph action never invokes the legacy A2A PNG/payload renderer. Do not infer
missing links, fabricate alerts or equate catalog membership with a complete
dependency path. A NO_DATA graph is unknown, not evidence of safety.

For provenance, distinguish host tool trace, authenticated server/A2A call,
and independent Oracle-side query/audit evidence. `Load Skill`, Google Search,
source labels and task IDs alone do not prove SQL execution. The returned
`query` is requested SQL; `executedSql` is agent-reported/normalized tool SQL,
not a signed execution receipt. Correlate `contextId` (not taskId) to Oracle
USER_AI_AGENT_TEAM_HISTORY.CONVERSATION_ID, then inspect SQL_TOOL OUTPUT by
TEAM_EXEC_ID. Check the nested result's SQL/rows and the view's GRAPH_TABLE
definition. Follow the runbook's
live checks and authorized read-only comparison; disclose missing audit
correlation instead of claiming full proof. Never modify data just to prove
liveness without separate approval.

Distinguish transfer services: `oracle_agent_java/InventoryActionAdkService`
is draft-only, but the existing **Oracle Supply-Chain A2UI** Gemini agent uses
the separate `oracle-supply-chain-a2ui` GCP service and Toolkit review/approval
API. Use that agent for the recommendation demo. The October 4 host check
verified native review cards and approval/cancel controls, not a write. Do not
click approval without authority to execute the exact transfer. Do not claim
the map/graph chat automatically hands evidence to this separate agent or
that its configured service actor is per-user delegation.

If implementing writes, require explicit authenticated user approval bound to
the exact draft, use a short-lived single-use handle, revalidate and lock
current Oracle rows, record an audit event, and commit the inventory movement
atomically. Never expose an unrestricted write tool to the model or browser.

## Change checklist

1. Verify the requested repository and current git changes before editing.
   Distinguish documentation requests from authority to deploy or write data.
2. Keep graph/spatial MCP App descriptors separate from the transfer A2UI
   descriptor; do not re-enable the transfer MCP App merely for symmetry.
3. Update the architecture explanation, flow diagram, prerequisites, commands,
   verification steps, and known implementation boundary in the workshop.
4. Link the repository architecture document and this skill from the relevant
   README or workshop lab.
5. Check links, screenshots and skill metadata for documentation edits. For
   code changes, run relevant Java/MCP tests; label fixtures versus live tests.
   Do not deploy or run an inventory transfer without explicit authorization.

## Canonical reference

The linked runbook is the maintained prompt/provenance/OAuth reference; avoid
duplicating its changing endpoint revisions or seed results in this skill.
Users can supply this SKILL.md and its references to ChatGPT or Claude. This
development guidance is distinct from Gemini's runtime “Load Skill” event.
