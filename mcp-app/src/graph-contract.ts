import { z } from "zod";

const text = z.string().min(1).max(200);
const node = z.object({ id: text, databaseId: text, sku: text,
  kind: z.enum(["SUPPLIER", "PLANT", "PORT", "WAREHOUSE", "PRODUCT", "ALERT"]), label: text });
const edge = z.object({ id: text, sku: text, source: text, target: text,
  kind: z.enum(["SUPPLIES", "SHIPS_VIA", "ROUTES_TO", "STOCKS", "AFFECTS"]) });
const pairs = { SUPPLIES: ["SUPPLIER", "PLANT"], SHIPS_VIA: ["PLANT", "PORT"],
  ROUTES_TO: ["PORT", "WAREHOUSE"], STOCKS: ["WAREHOUSE", "PRODUCT"], AFFECTS: ["ALERT", "PORT"] };

export const GraphEvidence = z.object({
  source: z.literal("oracle-ai-database-agent"), sku: text,
  status: z.enum(["DATA", "NO_DATA"]), nodes: z.array(node).max(500), edges: z.array(edge).max(1000),
  pathRows: z.number().int().min(0).max(1000), scope: z.string().min(1), taskId: text,
  query: z.string().min(1), sourceDetail: z.string(), executionMode: z.string(), interpretation: z.string()
}).superRefine((g, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  const ids = new Map(g.nodes.map(n => [n.id, n]));
  if (ids.size !== g.nodes.length || new Set(g.edges.map(e => e.id)).size !== g.edges.length)
    invalid("Duplicate graph identity");
  if (g.nodes.some(n => n.sku !== g.sku || n.id !== `${n.kind.toLowerCase()}:${n.databaseId}`
      || (n.kind === "PRODUCT" && n.databaseId !== g.sku))) invalid("Graph product/entity mismatch");
  for (const e of g.edges) {
    const kinds = pairs[e.kind];
    if (e.sku !== g.sku || ids.get(e.source)?.kind !== kinds[0] || ids.get(e.target)?.kind !== kinds[1]
        || e.id !== `${e.source}|${e.kind}|${e.target}`) invalid("Invalid graph relationship");
  }
  if (g.status === "NO_DATA" ? (g.nodes.length || g.edges.length || g.pathRows)
      : (!g.nodes.length || !g.edges.length || !g.pathRows || !ids.has(`product:${g.sku}`)))
    invalid("Graph status contradicts evidence");
});
export type GraphPayload = z.infer<typeof GraphEvidence>;
