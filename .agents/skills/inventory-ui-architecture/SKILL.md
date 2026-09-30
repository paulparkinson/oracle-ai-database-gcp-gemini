---
name: inventory-ui-architecture
description: Design or implement the Oracle inventory demo's MCP App exploration lane and A2A/A2UI decision lane, including workshop documentation and safe approval/write boundaries.
metadata:
  short-description: Maintain the inventory MCP App and A2UI architecture
---

# Inventory UI architecture

Use this skill when changing the Oracle inventory/supply-chain demo, its
workshop, or its agent guidance involving MCP Apps, A2UI, A2A, graph, spatial,
or inventory transfer workflows.

## Required architecture

Maintain two explicit lanes:

- **Explore:** MCP Apps for interactive, primarily read-only graph and spatial
  experiences (`inventory-graph-mcpapp` and `inventory-spatial-mcpapp`).
- **Decide and act:** A2A inventory-action coordinator returning A2UI for
  evidence, policy, transfer draft, and approval controls.

Do not describe MCP Apps as the agent orchestrator. An MCP server/tool obtains
the data and the sandboxed `ui://` resource renders it. Do not describe A2UI as
the orchestrator either: the A2A coordinator calls downstream agents/tools and
then emits the declarative UI.

## Safety and truthfulness

The current Java transfer implementation creates a draft and A2UI review
messages; it does not yet execute an Oracle inventory write. Preserve that
boundary in code and documentation unless a real, tested write path is added.

If implementing writes, require explicit authenticated user approval bound to
the exact draft, use a short-lived single-use handle, revalidate and lock
current Oracle rows, record an audit event, and commit the inventory movement
atomically. Never expose an unrestricted write tool to the model or browser.

## Change checklist

1. Inspect the Java A2A runtime, toolkit seed definitions, agent cards, and
   workshop lab before editing.
2. Keep graph/spatial MCP App descriptors separate from the transfer A2UI
   descriptor; do not re-enable the transfer MCP App merely for symmetry.
3. Update the architecture explanation, flow diagram, prerequisites, commands,
   verification steps, and known implementation boundary in the workshop.
4. Link the repository architecture document and this skill from the relevant
   README or workshop lab.
5. Run the focused Maven tests for the toolkit and the Java runtime checks that
   cover changed code. Do not deploy to the live VM without explicit request.

## Canonical reference

Read `docs/INVENTORY_UI_ARCHITECTURE.md` in the main project for the maintained
rationale, flows, implementation steps, and demo sequence.
