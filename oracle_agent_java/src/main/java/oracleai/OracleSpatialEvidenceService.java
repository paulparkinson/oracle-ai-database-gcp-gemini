package oracleai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import java.util.regex.Pattern;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

/** Managed-agent reads only. No Toolkit, host-supplied evidence, or static fallback. */
@Service
public class OracleSpatialEvidenceService {
    private final OracleAiDatabaseAgentClient client;
    private final ObjectMapper mapper;
    private final String owner;

    public OracleSpatialEvidenceService(OracleAiDatabaseAgentClient client, ObjectMapper mapper, Environment env) {
        this.client = client;
        this.mapper = mapper;
        this.owner = env.getProperty("INVENTORY_SCHEMA_OWNER", "FINANCIAL").toUpperCase(Locale.ROOT);
        if (!owner.matches("[A-Z][A-Z0-9_]*")) throw new IllegalStateException("Invalid inventory schema owner");
    }

    public SpatialEvidence fetch(String requestedSku) throws Exception {
        String sku = normalizeSku(requestedSku);
        String scope = owner + ".SC_INVENTORY_RISK_DEMO_V";
        // Keep PRODUCT_ID on every row. Filtering in Java prevents envelope-only SKU
        // validation from silently assigning another product's warehouse/risk to this SKU.
        String query = "SELECT PRODUCT_ID, WAREHOUSE_ID, WAREHOUSE_CODE, WAREHOUSE_NAME, "
                + "LATITUDE, LONGITUDE, HOTSPOT_SCORE, RECOMMENDED_ROLE FROM " + scope
                + " ORDER BY PRODUCT_ID, HOTSPOT_RANK FETCH FIRST 1001 ROWS ONLY";
        var result = client.answer(queryPrompt(query));
        Map<String, SpatialHotspot> matched = new LinkedHashMap<>();
        for (JsonNode row : rows(result.responseText())) {
            String productId = text(row, "PRODUCT_ID");
            if (!sku.equals(productId)) continue;
            String id = text(row, "WAREHOUSE_ID");
            var hotspot = new SpatialHotspot(productId, id, text(row, "WAREHOUSE_CODE"),
                    text(row, "WAREHOUSE_NAME"), text(row, "RECOMMENDED_ROLE").toUpperCase(Locale.ROOT),
                    number(row, "LATITUDE", -90, 90), number(row, "LONGITUDE", -180, 180),
                    number(row, "HOTSPOT_SCORE", 0, 1));
            var previous = matched.putIfAbsent(id, hotspot);
            if (previous != null && !previous.equals(hotspot))
                throw new IllegalStateException("Conflicting warehouse rows in managed-agent response");
        }
        var hotspots = List.copyOf(matched.values());
        var sources = hotspots.stream().filter(h -> Set.of("SOURCE", "SOURCE_BUFFER").contains(h.role())).toList();
        var targets = hotspots.stream().filter(h -> Set.of("TARGET", "DESTINATION", "DESTINATION_HOTSPOT", "RECEIVING").contains(h.role())).toList();
        List<List<Double>> route = List.of();
        if (sources.size() == 1 && targets.size() == 1) {
            var source = sources.get(0);
            var target = targets.get(0);
            route = List.of(List.of(source.longitude(), source.latitude()), List.of(target.longitude(), target.latitude()));
        }
        return new SpatialEvidence("oracle-ai-database-agent", sku, hotspots, route,
                result.sourceDetail(), result.executionMode(), hotspots.isEmpty() ? "NO_DATA" : "DATA",
                scope, result.taskId(), query);
    }

    public Map<String, Object> catalog() throws Exception {
        String scope = owner + ".SC_PRODUCTS";
        String query = "SELECT PRODUCT_ID, PRODUCT_NAME FROM " + scope
                + " ORDER BY PRODUCT_ID FETCH FIRST 1001 ROWS ONLY";
        var result = client.answer(queryPrompt(query));
        Map<String, String> products = new LinkedHashMap<>();
        for (JsonNode row : rows(result.responseText())) {
            String id = text(row, "PRODUCT_ID");
            String name = text(row, "PRODUCT_NAME");
            String old = products.putIfAbsent(id, name);
            if (old != null && !old.equals(name)) throw new IllegalStateException("Conflicting catalog rows");
        }
        var items = products.entrySet().stream()
                .map(e -> Map.of("sku", e.getKey(), "productName", e.getValue())).toList();
        return Map.of("source", "oracle-ai-database-agent", "scope", scope, "items", items,
                "status", items.isEmpty() ? "NO_DATA" : "DATA", "taskId", result.taskId(),
                "query", query, "executionMode", result.executionMode(), "sourceDetail", result.sourceDetail(),
                "interpretation", "Catalog scoped to " + scope
                        + " only, not every inventory table. Catalog membership does not establish spatial evidence or risk.");
    }

    /** Plain product-level summary: one managed-agent call, no map/graph requests. */
    public RiskList stockoutRisks() throws Exception {
        String scope = owner + ".SC_INVENTORY_RISK_DEMO_V";
        String query = "SELECT DISTINCT PRODUCT_ID, PRODUCT_NAME, QUARTER_LABEL, OVERALL_RISK_LEVEL, "
                + "STOCKOUT_PROBABILITY, PRIMARY_REGION FROM " + scope
                + " ORDER BY STOCKOUT_PROBABILITY DESC, PRODUCT_ID FETCH FIRST 1000 ROWS ONLY";
        var result = client.answer(queryPrompt(query));
        JsonNode rows = rows(result.responseText());
        // The upstream SQL tool caps at 1000; never rank a potentially partial set.
        if (rows.size() >= 1000) throw new IllegalStateException("Risk list exceeds upstream row limit");
        Map<String, RiskItem> unique = new LinkedHashMap<>();
        for (JsonNode row : rows) {
            String sku = text(row, "PRODUCT_ID");
            if (!normalizeSku(sku).equals(sku)) throw new IllegalStateException("Invalid product ID");
            String quarter = text(row, "QUARTER_LABEL");
            if (!quarter.matches("[0-9]{4}-Q[1-4]")) throw new IllegalStateException("Invalid risk period");
            var item = new RiskItem(sku, text(row, "PRODUCT_NAME"), quarter,
                    text(row, "OVERALL_RISK_LEVEL"), number(row, "STOCKOUT_PROBABILITY", 0, 1),
                    row.path("PRIMARY_REGION").isNull() ? "Not reported" : text(row, "PRIMARY_REGION"));
            var previous = unique.putIfAbsent(sku, item);
            if (previous != null && !previous.equals(item)) throw new IllegalStateException("Conflicting product risk rows");
        }
        var ranked = unique.values().stream().filter(r -> r.stockoutProbability() > 0)
                .sorted(Comparator.comparingDouble(RiskItem::stockoutProbability).reversed()
                    .thenComparing(RiskItem::sku)).toList();
        return new RiskList("oracle-ai-database-agent", scope, ranked.isEmpty() ? "NO_DATA" : "DATA",
                ranked.stream().limit(20).toList(), ranked.size(), ranked.size() > 20,
                "STOCKOUT_PROBABILITY", "0–1 probability for the returned quarter; seeded demo estimates",
                result.taskId(), result.contextId(), query);
    }

    public record RiskItem(String sku, String productName, String quarter, String riskLevel,
            double stockoutProbability, String primaryRegion) {}
    public record RiskList(String source, String scope, String status, List<RiskItem> items,
            int totalRows, boolean truncated, String riskMetric, String riskScale,
            String taskId, String contextId, String query) {}

    private static String queryPrompt(String query) {
        return "Execute this exact read-only SQL using your database query tool: " + query
                + ". Return ONLY JSON {\"rows\":[...]} with the SQL column names in uppercase. "
                + "Preserve every returned PRODUCT_ID and warehouse ID on its own row. Do not summarize, "
                + "combine products, infer coordinates, substitute another query, or use example/static data. "
                + "If the query fails return {\"error\":\"query failed\"}, not an empty rows array.";
    }

    private JsonNode rows(String response) throws Exception {
        String value = response == null ? "" : response.trim();
        if (value.startsWith("```") && value.endsWith("```") && value.indexOf('\n') >= 0)
            value = value.substring(value.indexOf('\n') + 1, value.length() - 3).trim();
        JsonNode root = mapper.reader().with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(value);
        if (root == null || root.has("error") || !root.path("rows").isArray())
            throw new IllegalStateException("Managed agent did not return database rows");
        if (root.path("rows").size() > 1000)
            throw new IllegalStateException("Evidence exceeds row limit; pagination is required");
        return root.path("rows");
    }

    static String normalizeSku(String value) {
        String sku = value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
        if (sku.length() > 40 || !sku.matches("[A-Z0-9]+(?:[-_][A-Z0-9]+)*"))
            throw new IllegalArgumentException("sku must be 1–40 letters/digits, optionally separated by hyphens or underscores.");
        return sku;
    }

    public static String skuFromPrompt(String prompt) {
        String value = prompt == null ? "" : prompt;
        var matcher = Pattern.compile("(?i)\\bSKU(?:[-_][A-Z0-9]+)+\\b").matcher(value);
        if (matcher.find()) return normalizeSku(matcher.group());
        // Non-SKU identifiers must be explicit uppercase product codes; do not
        // confuse prose such as 'stockout-risk' with a product.
        matcher = Pattern.compile("\\b[A-Z0-9]+(?:[-_][A-Z0-9]+)+\\b").matcher(value);
        return matcher.find() ? normalizeSku(matcher.group()) : DemoInventoryData.DEFAULT_PRODUCT_ID;
    }

    private static String text(JsonNode row, String field) {
        JsonNode node = row.path(field);
        if ((!node.isTextual() && !node.isIntegralNumber()) || node.asText().isBlank())
            throw new IllegalStateException("Missing database column " + field);
        return node.asText().trim();
    }

    private static double number(JsonNode row, String field, double min, double max) {
        JsonNode node = row.path(field);
        double n = node.asDouble(Double.NaN);
        if (!node.isNumber() || !Double.isFinite(n) || n < min || n > max)
            throw new IllegalStateException("Invalid database column " + field);
        return n;
    }

    public record SpatialHotspot(String sku, String warehouseId, String locationCode, String name,
            String role, double latitude, double longitude, double riskScore) {}

    public record SpatialEvidence(String source, String sku, List<SpatialHotspot> hotspots,
            List<List<Double>> route, String sourceDetail, String executionMode, String status,
            String scope, String taskId, String query) {
        public String summaryText() {
            return hotspots.isEmpty()
                    ? "No spatial rows for " + sku + " were returned from " + scope
                        + ". Risk is unknown, not stable or safe. This does not prove absence from other inventory tables."
                    : "Managed Oracle agent returned " + hotspots.size() + " warehouse rows for " + sku
                        + " from " + scope + ". HOTSPOT_SCORE is a 0–1 score, not a stockout probability. "
                        + "Any connection is a schematic source/destination link, not a road route or approved transfer. "
                        + "This is a one-time query; no monitoring has been scheduled.";
        }
    }
}
