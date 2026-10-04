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

const resourceUri = "ui://oracle-supply-chain/inventory-exchange-v2";
// Bump the resource URI when the embedded bundle changes so Gemini Enterprise
// does not reuse a cached MCP App document from the previous revision.
const spatialResourceUri = "ui://oracle-supply-chain/spatial-hotspots-v5";
// Keep the previous URI alive so hosts that cached v2 receive the corrected
// bundle instead of the old OpenStreetMap/CSP configuration.
const legacySpatialResourceUri = "ui://oracle-supply-chain/spatial-hotspots-v2";
const agentServiceUrl =
  process.env.AGENT_SERVICE_URL ?? "http://127.0.0.1:8080";
const oracleSpatialEvidenceUrl =
  process.env.ORACLE_SPATIAL_EVIDENCE_URL
  ?? new URL("/api/inventory/spatial-hotspots", agentServiceUrl).toString();
const agentServiceTimeoutMs =
  Number(process.env.AGENT_SERVICE_TIMEOUT_MS ?? "30000");
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
  name: z.string().min(1),
  role: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  riskScore: z.number()
});
const OracleAgentSpatialEvidenceSchema = z.object({
  source: z.literal("oracle-ai-database-agent"),
  sku: z.string(),
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
      stockoutRiskScore: hotspot.riskScore
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
    );
  }
  const evidence = OracleAgentSpatialEvidenceSchema.parse(payload);
  return {
    ...evidence,
    hotspots: evidence.hotspots.slice(0, maximumRows)
  };
}

// A stateless HTTP request owns its protocol instance. Sharing one McpServer
// makes overlapping requests reconnect an already-connected transport.
function createServer() {
const server = new McpServer({
  name: "Oracle Supply-Chain Inventory Exchange MCP App",
  version: "0.1.0"
});

registerAppTool(server, "show-inventory-transfer-dashboard", {
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

registerAppTool(server, "show-inventory-spatial-hotspots", {
  title: "Show inventory spatial hotspots",
  description:
    "Shows Oracle Database warehouse hotspot coordinates and the recommended relief route as an interactive MapLibre map.",
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
      text: `${response.source} returned ${response.hotspots.length} spatial hotspot features for ${response.sku}.`
    }],
    structuredContent: {
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
                properties: { kind: "relief-route", source: response.source }
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
