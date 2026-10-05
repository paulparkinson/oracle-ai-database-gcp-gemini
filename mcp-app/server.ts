import { readFile } from "node:fs/promises";
import path from "node:path";
import cors from "cors";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { GraphEvidence } from "./src/graph-contract.js";
import { riskListResult } from "./src/risk-list.js";

const resourceUri = "ui://oracle-supply-chain/inventory-exchange-v2";
// Bump the resource URI when the embedded bundle changes so Gemini Enterprise
// does not reuse a cached MCP App document from the previous revision.
const spatialResourceUri = "ui://oracle-supply-chain/spatial-hotspots-v6";
const graphResourceUri = "ui://oracle-supply-chain/supply-chain-graph-v1";
// Keep the previous URI alive so hosts that cached v2 receive the corrected
// bundle instead of the old OpenStreetMap/CSP configuration.
const legacySpatialResourceUri = "ui://oracle-supply-chain/spatial-hotspots-v2";
const agentServiceUrl =
  process.env.AGENT_SERVICE_URL ?? "http://127.0.0.1:8080";
const oracleSpatialEvidenceUrl =
  process.env.ORACLE_SPATIAL_EVIDENCE_URL
  ?? new URL("/api/inventory/spatial-hotspots", agentServiceUrl).toString();
const agentServiceTimeoutMs =
  Number(process.env.AGENT_SERVICE_TIMEOUT_MS ?? "90000");
const bindHost = process.env.MCP_BIND_HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "3001");
const writesEnabled = process.env.MCP_WRITES_ENABLED === "true";

const TransferRecommendationSchema = z.object({
  recommendationId: z.string(),
  productId: z.number().int().positive(),
  sku: z.string(),
  productName: z.string(),
  categoryName: z.string(),
  sourceLocationId: z.number().int().positive(),
  sourceLocationCode: z.string(),
  sourceLocationName: z.string(),
  targetLocationId: z.number().int().positive(),
  targetLocationCode: z.string(),
  targetLocationName: z.string(),
  sourceAvailableQuantity: z.number(),
  targetAvailableQuantity: z.number(),
  forecast7dQuantity: z.number(),
  safetyStockQuantity: z.number(),
  shortageQuantity: z.number().positive(),
  recommendedTransferQuantity: z.number().positive(),
  transitDays: z.number().int().positive(),
  unitTransferCost: z.number().nonnegative(),
  stockoutRiskScore: z.number().min(0).max(100),
  riskLevel: z.string(),
  rationale: z.string()
});
const GovernedRecommendationsSchema = z.object({
  source: z.literal("oracle-db-mcp-java-toolkit"),
  recommendations: z.array(TransferRecommendationSchema)
});
const GovernedReviewSchema = GovernedRecommendationsSchema.extend({
  approvalId: z.string().uuid()
});
const TransferResultSchema = z.object({
  transferId: z.number().int().positive(),
  recommendationId: z.string(),
  transferQuantity: z.number().positive(),
  status: z.literal("APPROVED")
});
const RejectionResultSchema = z.object({
  status: z.literal("REJECTED")
});
const SpatialHotspotSchema = z.object({
  sku: z.string(),
  warehouseId: z.string(),
  locationCode: z.string(),
  name: z.string().min(1),
  role: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  riskScore: z.number().min(0).max(1)
});
const OracleAgentSpatialEvidenceSchema = z.object({
  source: z.literal("oracle-ai-database-agent"),
  sku: z.string(),
  status: z.enum(["DATA", "NO_DATA"]),
  scope: z.string(),
  taskId: z.string(),
  query: z.string(),
  interpretation: z.string(),
  riskMetric: z.literal("HOTSPOT_SCORE"),
  riskScale: z.string(),
  routeKind: z.literal("schematic-source-destination-link"),
  hotspots: z.array(SpatialHotspotSchema),
  route: z.array(z.tuple([z.number(), z.number()])),
  sourceDetail: z.string().optional(),
  executionMode: z.string().optional()
});

async function agentFormRequest(
  pathName: string,
  values: Record<string, string | number>
) {
  const endpoint = new URL(pathName, agentServiceUrl);
  const body = new URLSearchParams();
  Object.entries(values).forEach(
    ([name, value]) => body.set(name, String(value))
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body,
    signal: AbortSignal.timeout(agentServiceTimeoutMs)
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof payload === "object"
        && payload !== null
        && "error" in payload
        && typeof payload.error === "string"
        ? payload.error
        : `Governed request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function loadGovernedReview(
  minimumStockoutRisk: number,
  maximumRows: number
) {
  return GovernedReviewSchema.parse(
    await agentFormRequest("/api/reviews", {
      minimumStockoutRisk,
      maximumRows
    })
  );
}

function spatialGeoJson(hotspots: z.infer<typeof SpatialHotspotSchema>[]) {
  return {
    type: "FeatureCollection",
    features: hotspots.map((hotspot) => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [hotspot.longitude, hotspot.latitude]
    },
    properties: {
      ...hotspot,
      locationName: hotspot.name,
      recommendedRole: hotspot.role,
      hotspotScore: hotspot.riskScore
    }
    }))
  };
}

async function loadOracleSpatialEvidence(sku: string, maximumRows: number) {
  const endpoint = new URL(oracleSpatialEvidenceUrl);
  endpoint.searchParams.set("sku", sku);
  const response = await fetch(endpoint, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(agentServiceTimeoutMs)
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      `Oracle AI Database Agent spatial endpoint failed with HTTP ${response.status}. `
        + "No MCP Toolkit or static spatial fallback is configured."
        + " Cause and risk are unknown; do not infer a missing SKU, database outage, or stable inventory."
    );
  }
  const evidence = OracleAgentSpatialEvidenceSchema.parse(payload);
  if (evidence.sku !== sku.trim().toUpperCase()
      || evidence.hotspots.some(h => h.sku !== evidence.sku)
      || (evidence.status === "NO_DATA") !== (evidence.hotspots.length === 0)) {
    throw new Error("Managed-agent evidence contract mismatch; no fallback is allowed.");
  }
  const hotspots = evidence.hotspots.slice(0, maximumRows);
  return {
    ...evidence,
    hotspots,
    totalRows: evidence.hotspots.length,
    truncated: hotspots.length < evidence.hotspots.length,
    route: evidence.route.every(p => hotspots.some(h => h.longitude === p[0] && h.latitude === p[1]))
      ? evidence.route : []
  };
}

// A stateless HTTP request owns its protocol instance. Sharing one McpServer
// makes overlapping requests reconnect an already-connected transport.
function createServer() {
const server = new McpServer({
  name: "Oracle Supply-Chain Inventory Exchange MCP App",
  version: "0.1.0"
});

if (writesEnabled) registerAppTool(server, "show-inventory-transfer-dashboard", {
  title: "Show inventory transfer dashboard",
  description:
    "Shows Oracle Database MCP Java Toolkit-governed stockout exposure and inventory-transfer recommendations.",
  inputSchema: {
    minimumStockoutRisk: z.number()
      .min(0)
      .max(100)
      .default(70)
      .describe("Minimum governed stockout-risk score"),
    maximumRows: z.number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum governed transfer recommendations to display")
  },
  _meta: {
    ui: {
      resourceUri,
      visibility: ["model", "app"]
    }
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: false
  }
}, async ({ minimumStockoutRisk, maximumRows }) => {
  const review = await loadGovernedReview(
    minimumStockoutRisk,
    maximumRows
  );
  return {
    content: [{
      type: "text",
      text:
        "Oracle Database MCP Java Toolkit returned "
        + `${review.recommendations.length} governed inventory-transfer recommendations `
        + "for explicit user review."
    }],
    structuredContent: {
      recommendations: review.recommendations,
      source: "oracle-db-mcp-java-toolkit",
      minimumStockoutRisk,
      maximumRows
    },
    _meta: writesEnabled ? { approvalId: review.approvalId } : {}
  };
});

server.registerTool("list-inventory-items", {
  title: "List managed Oracle inventory catalog",
  description: "Lists product IDs and names from the managed Oracle AI Database Agent SC_PRODUCTS catalog. For stockout-risk lists or rankings use list-inventory-stockout-risks instead; do not enumerate map/graph actions to infer risk. No Toolkit fallback.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: false }
}, async () => {
  const endpoint = new URL("/api/inventory/catalog", oracleSpatialEvidenceUrl);
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(agentServiceTimeoutMs) });
  if (!response.ok) throw new Error("Managed Oracle catalog unavailable; cause unknown. No Toolkit fallback.");
  const catalog = z.object({
    source: z.literal("oracle-ai-database-agent"), scope: z.string(), taskId: z.string(),
    query: z.string(), status: z.enum(["DATA", "NO_DATA"]), interpretation: z.string(),
    items: z.array(z.object({ sku: z.string(), productName: z.string() }))
  }).parse(await response.json());
  return { content: [{ type: "text", text: catalog.interpretation }], structuredContent: catalog };
});

server.registerTool("list-inventory-stockout-risks", {
  title: "List SKUs at risk of stockouts",
  description: "Use for simple questions such as 'list SKUs with risk of stock outages', 'list SKUs at risk of stockouts, highest risk first', or 'which products have stockout risk'. One server-side managed Oracle AI Database Agent query returns a concise product-risk table ranked by STOCKOUT_PROBABILITY, with database risk level, quarter and primary region. Plain text only, no MCP App. Answer only the table and metric note; do not load maps or graphs for this question. This probability is not HOTSPOT_SCORE or the Toolkit transfer risk score. No Google Search, Toolkit or invented-data fallback. NO_DATA does not establish safety.",
  inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: false }
}, async () => {
  const endpoint = new URL("/api/inventory/stockout-risks", oracleSpatialEvidenceUrl);
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(agentServiceTimeoutMs) });
  if (!response.ok) throw new Error("Managed Oracle risk list unavailable; cause unknown. Do not substitute map, graph, Toolkit or search results.");
  return riskListResult(await response.json());
});

registerAppTool(server, "show-supply-chain-graph", {
  title: "Show supply-chain dependency graph",
  description: "Only when the user explicitly requests a supply-chain/dependency GRAPH: query the managed Oracle AI Database Agent for SC_SUPPLY_CHAIN_GRAPH_V (GRAPH_TABLE/MATCH on SUPPLY_CHAIN_GRAPH) and open an interactive Cytoscape.js MCP App. Do NOT use for a simple SKU/risk list; use list-inventory-stockout-risks for that. Pass only a SKU, never nodes/edges/evidence. No joins, generated images, Toolkit, JDBC or static fallback. Errors are errors; NO_DATA is not safety.",
  inputSchema: { sku: z.string().min(1).max(40).describe("Product SKU to query") },
  _meta: { ui: { resourceUri: graphResourceUri, visibility: ["model", "app"] } },
  annotations: { readOnlyHint: true, openWorldHint: false }
}, async ({ sku }) => {
  const endpoint = new URL("/api/inventory/supply-chain-graph", oracleSpatialEvidenceUrl);
  endpoint.searchParams.set("sku", sku);
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(agentServiceTimeoutMs) });
  if (!response.ok) throw new Error("Managed Oracle graph evidence unavailable or invalid. Cause unknown; no fallback.");
  const graph = GraphEvidence.parse(await response.json());
  if (graph.sku !== sku.trim().toUpperCase()) throw new Error("Graph SKU mismatch; no graph rendered.");
  return { content: [{ type: "text", text: graph.interpretation + ` A2A task: ${graph.taskId}.` }],
    structuredContent: { ...graph, view: "supply-chain-graph" } };
});

registerAppResource(server, graphResourceUri, graphResourceUri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
  contents: [{ uri: graphResourceUri, mimeType: RESOURCE_MIME_TYPE,
    text: await readFile(path.join(import.meta.dirname, "dist", "graph-app.html"), "utf8"),
    _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } } }]
}));

registerAppTool(server, "show-inventory-spatial-hotspots", {
  title: "Show inventory spatial hotspots",
  description:
    "Only when the user explicitly requests a spatial hotspot MAP: query the managed Oracle AI Database Agent and render warehouse rows. Do NOT call for every SKU to answer a simple risk-list question; use list-inventory-stockout-risks instead. Pass only the SKU, never evidence. NO_DATA means risk UNKNOWN, not safe/stable. HOTSPOT_SCORE is not a probability; links are schematic, not road routes or transfer approvals. No Toolkit fallback or scheduled monitoring.",
  inputSchema: {
    sku: z.string().min(1).max(40).default("SKU-500")
      .describe("Product SKU to map"),
    maximumRows: z.number().int().min(2).max(50).default(20)
      .describe("Maximum Oracle AI Database Agent hotspot features")
  },
  _meta: {
    ui: {
      resourceUri: spatialResourceUri,
      visibility: ["model", "app"]
    }
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: false
  }
}, async ({ sku, maximumRows }) => {
  const response = await loadOracleSpatialEvidence(sku, maximumRows);
  return {
    content: [{
      type: "text",
      text: response.interpretation + ` Displaying ${response.hotspots.length} of ${response.totalRows} returned rows. A2A task: ${response.taskId}.`
    }],
    structuredContent: {
      ...response,
      view: "spatial-hotspots",
      source: response.source,
      sku: response.sku,
      hotspots: response.hotspots,
      geojson: {
        type: "FeatureCollection",
        features: [
          ...spatialGeoJson(response.hotspots).features,
          ...(response.route.length >= 2
            ? [{
                type: "Feature",
                geometry: { type: "LineString", coordinates: response.route },
                properties: { kind: response.routeKind, source: response.source }
              }]
            : [])
        ]
      },
      sourceDetail: response.sourceDetail,
      executionMode: response.executionMode
    }
  };
});

if (writesEnabled) {
  registerAppTool(server, "approve-inventory-transfer", {
    title: "Approve selected inventory transfer",
    description:
      "App-only action that executes one exact, previously reviewed Oracle-governed inventory transfer.",
    inputSchema: {
      approvalId: z.string().uuid(),
      recommendationId: z.string().min(1).max(100),
      approvalNotes: z.string().min(10).max(500)
    },
    _meta: {
      ui: {
        visibility: ["app"]
      }
    },
    annotations: {
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    }
  }, async ({ approvalId, recommendationId, approvalNotes }) => {
    const result = TransferResultSchema.parse(
      await agentFormRequest("/api/approve", {
        approvalId,
        recommendationId,
        approvalNotes
      })
    );
    return {
      content: [{
        type: "text",
        text:
          `Approved governed inventory transfer ${result.transferId} `
          + `for recommendation ${result.recommendationId}.`
      }],
      structuredContent: result
    };
  });

  registerAppTool(server, "reject-inventory-transfer-review", {
    title: "Cancel inventory transfer review",
    description:
      "App-only action that invalidates the current approval handle without writing an inventory transfer.",
    inputSchema: {
      approvalId: z.string().uuid()
    },
    _meta: {
      ui: {
        visibility: ["app"]
      }
    },
    annotations: {
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  }, async ({ approvalId }) => {
    const result = RejectionResultSchema.parse(
      await agentFormRequest("/api/reject", { approvalId })
    );
    return {
      content: [{
        type: "text",
        text: "Cancelled the inventory-transfer review; no database write ran."
      }],
      structuredContent: result
    };
  });
}

registerAppResource(
  server,
  resourceUri,
  resourceUri,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => ({
    contents: [{
      uri: resourceUri,
      mimeType: RESOURCE_MIME_TYPE,
      text: await readFile(
        path.join(import.meta.dirname, "dist", "mcp-app.html"),
        "utf8"
      ),
      _meta: {
        ui: {
          prefersBorder: true,
          csp: {
            connectDomains: [],
            resourceDomains: ["https://www.oracle.com"]
          }
        }
      }
    }]
  })
);

registerAppResource(
  server,
  spatialResourceUri,
  spatialResourceUri,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => ({
    contents: [{
      uri: spatialResourceUri,
      mimeType: RESOURCE_MIME_TYPE,
      text: await readFile(
        path.join(import.meta.dirname, "dist", "mcp-app.html"),
        "utf8"
      ),
      _meta: {
        ui: {
          prefersBorder: true,
          csp: {
            connectDomains: ["https://tile.openstreetmap.org"],
            resourceDomains: [
              "https://www.oracle.com",
              "https://unpkg.com",
              "https://tile.openstreetmap.org"
            ]
          }
        }
      }
    }]
  })
);

registerAppResource(
  server,
  legacySpatialResourceUri,
  legacySpatialResourceUri,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => ({
    contents: [{
      uri: legacySpatialResourceUri,
      mimeType: RESOURCE_MIME_TYPE,
      text: await readFile(
        path.join(import.meta.dirname, "dist", "mcp-app.html"),
        "utf8"
      ),
      _meta: {
        ui: {
          prefersBorder: true,
          csp: {
            connectDomains: ["https://tile.openstreetmap.org"],
            resourceDomains: [
              "https://www.oracle.com",
              "https://unpkg.com",
              "https://tile.openstreetmap.org"
            ]
          }
        }
      }
    }]
  })
);

return server;
}

const app = express();
app.use(cors({ origin: false }));
app.use(express.json({ limit: "256kb" }));
app.get(
  "/health",
  (_request, response) =>
    response.json({
      status: "UP",
      dataSource: "oracle-ai-database-agent-via-java-gateway",
      spatialFallback: "disabled",
      writeActionsEnabled: writesEnabled
    })
);
app.post("/mcp", async (request, response) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  response.on("close", () => { void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(request, response, request.body);
});
const listener = app.listen(
  port,
  bindHost,
  () => {
    const address = listener.address();
    const boundPort = typeof address === "object" && address ? address.port : port;
    console.log("Supply-chain MCP App server listening on "
      + `http://${bindHost}:${boundPort}/mcp`);
  }
);
