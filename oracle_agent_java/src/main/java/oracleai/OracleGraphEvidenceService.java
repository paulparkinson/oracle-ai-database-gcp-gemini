package oracleai;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

/** Supply-chain relationship read via the managed agent, never JDBC/Toolkit/host payload fallback. */
@Service
public class OracleGraphEvidenceService {
    private final OracleAiDatabaseAgentClient client;
    private final ObjectMapper mapper;
    private final String owner;

    public OracleGraphEvidenceService(OracleAiDatabaseAgentClient client, ObjectMapper mapper, Environment env) {
        this.client = client;
        this.mapper = mapper;
        owner = env.getProperty("INVENTORY_SCHEMA_OWNER", "FINANCIAL").toUpperCase(Locale.ROOT);
        if (!owner.matches("[A-Z][A-Z0-9_]*")) throw new IllegalStateException("Invalid inventory schema owner");
    }

    public GraphEvidence fetch(String requestedSku) throws Exception {
        String sku = OracleSpatialEvidenceService.normalizeSku(requestedSku);
        String query = query();
        var response = client.answer("Execute this exact read-only SQL using your database query tool: " + query
                + ". This view executes GRAPH_TABLE/MATCH in Oracle. Query the view exactly; never rewrite it as table joins. "
                + "Return ONLY JSON {\"executedSql\":\"the actual sql_query from the query tool\",\"rows\":[...]} "
                + "with uppercase SQL column names. Copy sql_query and sql_result from the tool output, not the prompt. "
                + "Format executedSql on ONE LINE with unquoted uppercase identifiers, retaining aliases from the tool output. "
                + "Do not put newlines or double-quoted SQL identifiers inside the JSON string. "
                + "Preserve all product and entity IDs. Do not summarize, invent nodes or edges, "
                + "infer missing paths, or use examples/static data. "
                + "Return SQL NULL as JSON null. If the query fails return {\"error\":\"query failed\"}.");
        if (response.taskId() == null || response.taskId().isBlank())
            throw new IllegalStateException("Managed-agent task ID missing");
        String value = response.responseText() == null ? "" : response.responseText().trim();
        if (value.startsWith("```") && value.endsWith("```") && value.indexOf('\n') >= 0)
            value = value.substring(value.indexOf('\n') + 1, value.length() - 3).trim();
        JsonNode root = mapper.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(value);
        if (root == null || root.has("error") || !root.path("rows").isArray())
            throw new IllegalStateException("Managed agent did not return graph query rows");
        String executedSql = root.path("executedSql").asText("");
        if (!isRequiredViewQuery(executedSql))
            throw new IllegalStateException("Managed agent did not report the required property-graph query; no join fallback permitted");
        if (root.path("rows").size() >= 1000)
            throw new IllegalStateException("Graph query exceeds row limit; pagination required");
        Map<String, GraphNode> nodes = new LinkedHashMap<>();
        Map<String, GraphEdge> edges = new LinkedHashMap<>();
        int pathRows = 0;
        for (JsonNode row : root.path("rows")) {
            if (!sku.equals(text(row, "PRODUCT_ID"))) continue;
            pathRows++;
            String supplier = node(nodes, row, sku, "SUPPLIER");
            String plant = node(nodes, row, sku, "PLANT");
            String port = node(nodes, row, sku, "PORT");
            String warehouse = node(nodes, row, sku, "WAREHOUSE");
            String product = node(nodes, row, sku, "PRODUCT");
            edge(edges, sku, supplier, plant, "SUPPLIES");
            edge(edges, sku, plant, port, "SHIPS_VIA");
            edge(edges, sku, port, warehouse, "ROUTES_TO");
            edge(edges, sku, warehouse, product, "STOCKS");
            if (!row.has("ALERT_ID") || !row.has("ALERT_NAME"))
                throw new IllegalStateException("Missing nullable alert columns");
            if (!row.path("ALERT_ID").isNull()) {
                String alert = node(nodes, row, sku, "ALERT");
                edge(edges, sku, alert, port, "AFFECTS");
            } else if (!row.path("ALERT_NAME").isNull()) {
                throw new IllegalStateException("Alert name without identity");
            }
        }
        if (nodes.size() > 500 || edges.size() > 1000)
            throw new IllegalStateException("Graph exceeds interactive display limit");
        String scope = owner + ".SUPPLY_CHAIN_GRAPH via SC_SUPPLY_CHAIN_GRAPH_V (SQL/PGQ GRAPH_TABLE / MATCH)";
        String interpretation = nodes.isEmpty()
                ? "No complete active supply-chain paths returned for " + sku + " from " + scope
                    + ". This does not prove the product is absent or its supply chain is safe."
                : "Managed Oracle agent returned " + pathRows + " path rows for " + sku + ", represented as "
                    + nodes.size() + " nodes and " + edges.size() + " distinct typed relationships. "
                    + "This is a bounded dependency view, not a transfer recommendation or continuous monitoring.";
        return new GraphEvidence("oracle-ai-database-agent", sku, nodes.isEmpty() ? "NO_DATA" : "DATA",
                List.copyOf(nodes.values()), List.copyOf(edges.values()), pathRows, scope,
                response.taskId(), response.contextId(), query, executedSql, response.sourceDetail(), response.executionMode(), interpretation);
    }

    // The view owns the fixed GRAPH_TABLE/MATCH traversal. The managed agent's
    // table/view profile cannot mix direct property-graph objects into object_list.
    String query() {
        return "SELECT SUPPLIER_ID, SUPPLIER_NAME, PLANT_ID, PLANT_NAME, PORT_ID, PORT_NAME, "
                + "WAREHOUSE_ID, WAREHOUSE_NAME, PRODUCT_ID, PRODUCT_NAME, ALERT_ID, ALERT_NAME "
                + "FROM " + owner + ".SC_SUPPLY_CHAIN_GRAPH_V "
                + "ORDER BY PRODUCT_ID, SUPPLIER_ID, PLANT_ID, PORT_ID, WAREHOUSE_ID, ALERT_ID "
                + "FETCH FIRST 1000 ROWS ONLY";
    }

    // Allow only identity-preserving aliases emitted by Select AI, not arbitrary
    // semantically similar SQL. Never execute the reported SQL in this gateway.
    private boolean isRequiredViewQuery(String sql) {
        String normalized = sql.replaceAll("\"([A-Z][A-Z0-9_]*)\"", "$1").trim();
        var from = java.util.regex.Pattern.compile("(?i)\\bFROM\\s+" + owner
                + "\\.SC_SUPPLY_CHAIN_GRAPH_V(?:\\s+([A-Z][A-Z0-9_]*))?\\s+ORDER\\s+BY\\b").matcher(normalized);
        if (!from.find()) return false;
        String alias = from.group(1);
        if (alias != null) {
            normalized = normalized.substring(0, from.start()) + "FROM " + owner
                    + ".SC_SUPPLY_CHAIN_GRAPH_V ORDER BY" + normalized.substring(from.end());
            normalized = normalized.replaceAll("(?i)\\b" + java.util.regex.Pattern.quote(alias) + "\\s*\\.\\s*", "");
        }
        for (String column : List.of("SUPPLIER_ID", "SUPPLIER_NAME", "PLANT_ID", "PLANT_NAME",
                "PORT_ID", "PORT_NAME", "WAREHOUSE_ID", "WAREHOUSE_NAME", "PRODUCT_ID",
                "PRODUCT_NAME", "ALERT_ID", "ALERT_NAME")) {
            normalized = normalized.replaceAll("(?i)\\b" + column + "\\s+AS\\s+" + column + "\\b", column);
        }
        return normalizeSql(query()).equals(normalizeSql(normalized));
    }

    // Only formatting differences are allowed. This is an agent-reported SQL check,
    // not a signed database receipt; independent Oracle diagnostics remain necessary.
    private static String normalizeSql(String sql) {
        return java.util.regex.Pattern.compile("'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|[^'\"]+").matcher(sql).results()
                .map(m -> m.group().startsWith("'") ? m.group()
                    : m.group().startsWith("\"") ? m.group().replaceAll("^\"([A-Z][A-Z0-9_]*)\"$", "$1")
                    : m.group().replaceAll("\\s+", "").toUpperCase(Locale.ROOT))
                .collect(java.util.stream.Collectors.joining()).replaceAll(";+$", "");
    }

    private static String node(Map<String, GraphNode> nodes, JsonNode row, String sku, String kind) {
        String databaseId = text(row, kind + "_ID");
        if (!kind.equals("PRODUCT") && !databaseId.matches("[0-9]{1,38}"))
            throw new IllegalStateException("Invalid graph entity ID");
        String id = kind.toLowerCase(Locale.ROOT) + ":" + databaseId;
        GraphNode next = new GraphNode(id, databaseId, sku, kind, text(row, kind + "_NAME"));
        GraphNode previous = nodes.putIfAbsent(id, next);
        if (previous != null && !previous.equals(next))
            throw new IllegalStateException("Conflicting graph entity rows");
        return id;
    }

    private static void edge(Map<String, GraphEdge> edges, String sku, String from, String to, String kind) {
        String id = from + "|" + kind + "|" + to;
        edges.putIfAbsent(id, new GraphEdge(id, sku, from, to, kind));
    }

    private static String text(JsonNode row, String field) {
        JsonNode value = row.path(field);
        if ((!value.isTextual() && !value.isIntegralNumber()) || value.asText().isBlank()
                || value.asText().length() > 200)
            throw new IllegalStateException("Invalid/missing graph column " + field);
        return value.asText().trim();
    }

    public record GraphNode(String id, String databaseId, String sku, String kind, String label) {}
    // Edge ID is a stable UI relationship key, NOT an Oracle edge-table primary key.
    public record GraphEdge(String id, String sku, String source, String target, String kind) {}
    public record GraphEvidence(String source, String sku, String status, List<GraphNode> nodes,
            List<GraphEdge> edges, int pathRows, String scope, String taskId, String contextId, String query, String executedSql,
            String sourceDetail, String executionMode, String interpretation) {}
}
