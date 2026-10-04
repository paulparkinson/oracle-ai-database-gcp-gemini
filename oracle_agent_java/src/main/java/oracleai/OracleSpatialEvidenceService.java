package oracleai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/**
 * Retrieves spatial evidence from the managed Oracle AI Database Agent.
 *
 * <p>This service deliberately has no local, static, Select AI, or MCP Toolkit
 * fallback. The MCP App must fail closed when the managed agent cannot return
 * verifiable evidence.</p>
 */
@Service
public class OracleSpatialEvidenceService {

    private static final Pattern SKU_PATTERN = Pattern.compile("\\b([A-Z][A-Z0-9]*-\\d+)\\b");
    private final OracleAiDatabaseAgentClient oracleAgentClient;
    private final ObjectMapper objectMapper;

    public OracleSpatialEvidenceService(
            OracleAiDatabaseAgentClient oracleAgentClient,
            ObjectMapper objectMapper
    ) {
        this.oracleAgentClient = oracleAgentClient;
        this.objectMapper = objectMapper;
    }

    public SpatialEvidence fetch(String requestedSku) throws Exception {
        String sku = normalizeSku(requestedSku);
        String prompt = """
                For %s, query the Oracle inventory-risk data and return ONLY valid JSON with this exact shape: {"sku":"%s","hotspots":[{"name":"warehouse or location name","role":"SOURCE, TARGET, DESTINATION, RECEIVING, or RELAY","latitude":0.0,"longitude":0.0,"riskScore":0.0}],"route":[[0.0,0.0],[0.0,0.0]]}. Use only values retrieved from the database; do not invent or explain outside the JSON.
                """.formatted(sku, sku);

        OracleAiDatabaseAgentClient.RemoteDatabaseResult result = oracleAgentClient.answer(prompt);
        JsonNode root = parseJsonObject(result.responseText());
        String responseSku = root.path("sku").asText("").trim().toUpperCase(Locale.ROOT);
        if (!sku.equals(responseSku)) {
            throw new IllegalStateException(
                    "Oracle AI Database agent returned spatial evidence for '"
                            + responseSku + "' instead of requested '" + sku + "'."
            );
        }

        JsonNode hotspotsNode = root.path("hotspots");
        if (!hotspotsNode.isArray()) {
            throw new IllegalStateException("Oracle AI Database agent spatial response has no hotspots array.");
        }

        List<SpatialHotspot> hotspots = new ArrayList<>();
        for (JsonNode hotspotNode : hotspotsNode) {
            String name = requiredText(hotspotNode, "name");
            String role = requiredText(hotspotNode, "role").toUpperCase(Locale.ROOT);
            double latitude = requiredNumber(hotspotNode, "latitude");
            double longitude = requiredNumber(hotspotNode, "longitude");
            double riskScore = requiredNumber(hotspotNode, "riskScore");
            if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
                throw new IllegalStateException("Oracle AI Database agent returned invalid coordinates for " + name + ".");
            }
            if (riskScore < 0 || riskScore > 1 && riskScore > 100) {
                throw new IllegalStateException("Oracle AI Database agent returned invalid riskScore for " + name + ".");
            }
            hotspots.add(new SpatialHotspot(name, role, latitude, longitude, riskScore));
        }

        // The route is derived only from verified source/target coordinates in
        // the same managed-agent response. No coordinates are synthesized.
        List<List<Double>> route = verifiedRoute(root.path("route"));
        if (route.isEmpty()) {
            SpatialHotspot source = findRole(hotspots, "SOURCE");
            SpatialHotspot target = findAnyRole(hotspots, "TARGET", "DESTINATION", "RECEIVING");
            if (source != null && target != null) {
                route = List.of(
                        List.of(source.longitude(), source.latitude()),
                        List.of(target.longitude(), target.latitude())
                );
            }
        }

        return new SpatialEvidence(
                "oracle-ai-database-agent",
                sku,
                hotspots,
                route,
                result.sourceDetail(),
                result.executionMode()
        );
    }

    public static String skuFromPrompt(String prompt) {
        Matcher matcher = SKU_PATTERN.matcher(prompt == null ? "" : prompt.toUpperCase(Locale.ROOT));
        return matcher.find() ? matcher.group(1) : DemoInventoryData.DEFAULT_PRODUCT_ID;
    }

    private static String normalizeSku(String value) {
        String sku = value == null || value.isBlank() ? DemoInventoryData.DEFAULT_PRODUCT_ID : value.trim();
        if (!SKU_PATTERN.matcher(sku.toUpperCase(Locale.ROOT)).matches()) {
            throw new IllegalArgumentException("sku must look like SKU-500.");
        }
        return sku.toUpperCase(Locale.ROOT);
    }

    private JsonNode parseJsonObject(String responseText) throws Exception {
        String text = responseText == null ? "" : responseText.trim();
        if (text.startsWith("```") && text.endsWith("```")) {
            int firstNewline = text.indexOf('\n');
            text = firstNewline >= 0 ? text.substring(firstNewline + 1, text.length() - 3).trim() : text;
        }
        try {
            JsonNode parsed = objectMapper.readTree(text);
            if (parsed != null && parsed.isObject()) {
                return parsed;
            }
        } catch (Exception ignored) {
            // The managed agent was asked for JSON, but extracting one object
            // lets us reject prose without confusing it with a local fallback.
        }
        int start = text.indexOf('{');
        int end = text.lastIndexOf('}');
        if (start < 0 || end <= start) {
            throw new IllegalStateException("Oracle AI Database agent did not return a JSON spatial evidence object.");
        }
        JsonNode parsed = objectMapper.readTree(text.substring(start, end + 1));
        if (parsed == null || !parsed.isObject()) {
            throw new IllegalStateException("Oracle AI Database agent spatial evidence is not a JSON object.");
        }
        return parsed;
    }

    private static String requiredText(JsonNode node, String field) {
        String value = node.path(field).asText("").trim();
        if (value.isBlank()) {
            throw new IllegalStateException("Oracle AI Database agent spatial evidence is missing '" + field + "'.");
        }
        return value;
    }

    private static double requiredNumber(JsonNode node, String field) {
        JsonNode value = node.path(field);
        if (!value.isNumber()) {
            throw new IllegalStateException("Oracle AI Database agent spatial evidence field '" + field + "' is not numeric.");
        }
        return value.asDouble();
    }

    private static List<List<Double>> verifiedRoute(JsonNode routeNode) {
        if (!routeNode.isArray()) {
            return List.of();
        }
        List<List<Double>> route = new ArrayList<>();
        for (JsonNode point : routeNode) {
            if (!point.isArray() || point.size() != 2 || !point.get(0).isNumber() || !point.get(1).isNumber()) {
                return List.of();
            }
            double longitude = point.get(0).asDouble();
            double latitude = point.get(1).asDouble();
            if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
                return List.of();
            }
            route.add(List.of(longitude, latitude));
        }
        if (route.size() < 2) {
            return List.of();
        }
        boolean placeholderRoute = route.stream().allMatch(
                point -> Double.compare(point.get(0), 0.0d) == 0
                        && Double.compare(point.get(1), 0.0d) == 0
        );
        return placeholderRoute ? List.of() : route;
    }

    private static SpatialHotspot findRole(List<SpatialHotspot> hotspots, String role) {
        return hotspots.stream()
                .filter(hotspot -> hotspot.role().contains(role))
                .findFirst()
                .orElse(null);
    }

    private static SpatialHotspot findAnyRole(List<SpatialHotspot> hotspots, String... roles) {
        for (String role : roles) {
            SpatialHotspot found = findRole(hotspots, role);
            if (found != null) {
                return found;
            }
        }
        return null;
    }

    public record SpatialHotspot(
            String name,
            String role,
            double latitude,
            double longitude,
            double riskScore
    ) {}

    public record SpatialEvidence(
            String source,
            String sku,
            List<SpatialHotspot> hotspots,
            List<List<Double>> route,
            String sourceDetail,
            String executionMode
    ) {
        public String summaryText() {
            return "Oracle AI Database Agent returned " + hotspots.size()
                    + " spatial hotspot(s) for " + sku + ".";
        }
    }
}
