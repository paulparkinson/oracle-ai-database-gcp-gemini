import { z } from "zod";

export const RiskList = z.object({
  source: z.literal("oracle-ai-database-agent"), scope: z.string().min(1),
  status: z.enum(["DATA", "NO_DATA"]),
  riskMetric: z.literal("STOCKOUT_PROBABILITY"), riskScale: z.string().min(1),
  taskId: z.string().min(1), contextId: z.string().min(1), query: z.string().min(1),
  totalRows: z.number().int().nonnegative(), truncated: z.boolean(),
  items: z.array(z.object({
    sku: z.string().min(1), productName: z.string().min(1), quarter: z.string().regex(/^\d{4}-Q[1-4]$/),
    riskLevel: z.string().min(1), stockoutProbability: z.number().gt(0).max(1), primaryRegion: z.string().min(1)
  })).max(20)
}).superRefine((r, ctx) => {
  if ((r.status === "DATA") !== (r.items.length > 0)
      || r.totalRows < r.items.length || r.truncated !== (r.totalRows > r.items.length)
      || new Set(r.items.map(i => i.sku)).size !== r.items.length
      || r.items.some((item, n) => n > 0 && item.stockoutProbability > r.items[n - 1].stockoutProbability)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Inconsistent risk summary" });
  }
});

// Plain text, deliberately no ui:// metadata or visualization resource.
export function riskListResult(input: unknown) {
  const r = RiskList.parse(input);
  const cell = (v: string) => v.replace(/[|\r\n<>]/g, " ");
  const table = r.items.length ? [
    "| SKU | Product | Risk | Stockout probability (0–1) | Quarter | Primary region |",
    "| --- | --- | --- | --- | --- | --- |",
    ...r.items.map(i => `| ${cell(i.sku)} | ${cell(i.productName)} | ${cell(i.riskLevel)} | ${i.stockoutProbability} | ${i.quarter} | ${cell(i.primaryRegion)} |`)
  ].join("\n") : "No positive stockout-risk rows returned from this scoped view; other inventory risk is unknown.";
  return {
    content: [{ type: "text" as const, text: table + "\n\nSeeded Oracle demo estimates for the stated quarter; not spatial hotspot scores."
      + (r.truncated ? ` Showing ${r.items.length} of ${r.totalRows} products.` : "")
      + "\nRespond with this compact table and metric note only. Do not call map or graph tools, add warehouse breakdowns, recommend transfers, or infer urgency unless separately requested." }],
    structuredContent: r
  };
}
