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
                + ". Return ONLY JSON {\"rows\":[...]} with uppercase SQL column names. "
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
        String scope = owner + ".SC_* supply-chain vertex and relationship tables (relational joins, not GRAPH_TABLE)";
        String interpretation = nodes.isEmpty()
                ? "No complete active supply-chain paths returned for " + sku + " from " + scope
                    + ". This does not prove the product is absent or its supply chain is safe."
                : "Managed Oracle agent returned " + pathRows + " path rows for " + sku + ", represented as "
                    + nodes.size() + " nodes and " + edges.size() + " distinct typed relationships. "
                    + "This is a bounded dependency view, not a transfer recommendation or continuous monitoring.";
        return new GraphEvidence("oracle-ai-database-agent", sku, nodes.isEmpty() ? "NO_DATA" : "DATA",
                List.copyOf(nodes.values()), List.copyOf(edges.values()), pathRows, scope,
                response.taskId(), query, response.sourceDetail(), response.executionMode(), interpretation);
    }

    // Explicit relational traversal of the property graph's backing tables. The managed
    // profile exposes these tables, not GRAPH_TABLE execution. This is the sole read path,
    // not an automatic fallback. Keep PRODUCT_ID and filter each row in Java.
    String query() {
        return """
            SELECT s.supplier_id, s.supplier_name, p.plant_id, p.plant_name,
                   po.port_id, po.port_name, w.warehouse_id, w.warehouse_name,
                   pr.product_id, pr.product_name, a.alert_id, a.alert_name
            FROM %1$s.SC_SUPPLIERS s
            JOIN %1$s.SC_SUPPLIER_PLANT sp ON sp.supplier_id = s.supplier_id AND sp.is_current = CHR(89)
            JOIN %1$s.SC_PLANTS p ON p.plant_id = sp.plant_id
            JOIN %1$s.SC_PLANT_PORT pp ON pp.plant_id = p.plant_id AND pp.is_current = CHR(89)
            JOIN %1$s.SC_PORTS po ON po.port_id = pp.port_id
            JOIN %1$s.SC_PORT_WAREHOUSE pw ON pw.port_id = po.port_id AND pw.is_current = CHR(89)
            JOIN %1$s.SC_WAREHOUSES w ON w.warehouse_id = pw.warehouse_id
            JOIN %1$s.SC_WAREHOUSE_PRODUCT wp ON wp.warehouse_id = w.warehouse_id AND wp.is_current = CHR(89)
            JOIN %1$s.SC_PRODUCTS pr ON pr.product_id = wp.product_id
            LEFT JOIN %1$s.SC_ALERT_PORT ap ON ap.port_id = po.port_id AND ap.is_current = CHR(89)
            LEFT JOIN %1$s.SC_ALERTS a ON a.alert_id = ap.alert_id AND a.active_flag = CHR(89)
            WHERE s.active_flag = CHR(89) AND p.active_flag = CHR(89) AND po.active_flag = CHR(89)
              AND w.active_flag = CHR(89) AND pr.active_flag = CHR(89)
            ORDER BY pr.product_id, s.supplier_id, p.plant_id, po.port_id, w.warehouse_id, a.alert_id
            FETCH FIRST 1000 ROWS ONLY
            """.formatted(owner).strip();
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
            List<GraphEdge> edges, int pathRows, String scope, String taskId, String query,
            String sourceDetail, String executionMode, String interpretation) {}
}
