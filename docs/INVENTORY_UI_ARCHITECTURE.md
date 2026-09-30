# Inventory UI architecture: MCP Apps and A2UI

This project deliberately demonstrates two UI paths for the same inventory and
supply-chain domain. The split is based on interaction style, not on a claim
that one protocol owns a particular business subject.

## The two lanes

```text
Gemini Enterprise inventory app
├── Explore
│   ├── MCP App: spatial warehouse hotspots
│   └── MCP App: property-graph dependencies
└── Decide and act
    └── A2A inventory-action agent → A2UI review surface
```

### MCP Apps: explore

Use an MCP App when the user wants a rich, interactive, primarily read-only
view: maps, graph traversal, filters, drill-downs, or comparison controls.
The host invokes a bounded MCP tool, receives structured Oracle-backed data,
and loads the associated `ui://` resource in a sandbox.

```text
user selects SKU
  → MCP tool or MCP-backed adapter
  → governed Oracle query / Oracle-backed agent
  → structured result
  → sandboxed spatial or graph MCP App
```

The MCP App is presentation code. It does not receive database credentials and
must not choose a different SKU, route, quantity, or database operation than
the server returned.

### A2UI: decide and act

Use A2UI when an agent must synthesize evidence and present a workflow: risk
explanation, recommended transfer, policy result, approval state, and the next
user action.

```text
user asks what to do
  → A2A inventory-action coordinator
  → graph, spatial, external, and Oracle database evidence
  → policy check and transfer draft
  → A2UI review controls
  → explicit authenticated approval
  → governed server/database write path
```

A2UI is a declarative UI contract, not an orchestration engine. The A2A
coordinator performs downstream calls and constructs the A2UI messages. The
database remains the final authority for authorization, current-stock
revalidation, row locking, audit, and the transaction.

## Current implementation boundary

The Java A2A runtime already returns A2UI v0.8 transfer-review messages. The
current implementation creates a draft and exposes request-approval/cancel
intents; it does not yet execute an inventory transfer in Oracle. Do not call
the current draft flow a completed write path.

The full-stack toolkit seeds the complementary MCP App descriptors:

- `inventory-spatial-mcpapp` — interactive spatial exploration
- `inventory-graph-mcpapp` — interactive dependency exploration
- `inventory-transfer-a2ui` — A2A/A2UI review surface, with MCP App disabled

## Implementation steps

1. Prepare the governed Oracle inventory, warehouse, graph, and spatial data.
2. Expose bounded read-only MCP tools for graph and spatial evidence.
3. Associate those tools with `ui://` MCP App resources and register them with
   an MCP Apps-compatible host.
4. Expose the inventory-action coordinator through A2A with the A2UI extension
   and the host-approved catalog.
5. Have the coordinator gather Oracle/graph/spatial evidence, run policy, and
   return an immutable transfer draft.
6. Render the draft and approval controls as A2UI.
7. Add the write path separately: bind approval to the authenticated actor and
   exact draft, make the approval handle short-lived and single-use, revalidate
   current inventory in Oracle, lock the affected rows, write the transfer and
   audit records in one transaction, and return the committed result.
8. Test rejection, expiry, replay, actor mismatch, changed quantities/routes,
   insufficient stock, and transaction rollback before enabling production
   writes.

## Suggested demo sequence

1. Open the spatial MCP App and show the SKU-500 warehouse hotspot and relief
   route.
2. Open the graph MCP App and traverse the supplier → plant → port → warehouse
   dependency path.
3. Ask the A2A inventory-action agent what action should be taken.
4. Review the A2UI recommendation, policy explanation, and proposed transfer.
5. Approve only after the governed write path is installed and verified; until
   then, demonstrate the draft/review state and say that execution is disabled.

Related implementation and workshop material:

- [`oracle_agent_java/README.md`](../oracle_agent_java/README.md)
- [`a2ui-mcpapps/a2ui-mcpapps.md`](https://github.com/paulparkinson/multicloud-gcpagenticai-oracledb/blob/main/a2ui-mcpapps/a2ui-mcpapps.md)
- [`oracle-ai-database-fullstack-toolkit`](https://github.com/paulparkinson/oracle-ai-database-fullstack-toolkit)
