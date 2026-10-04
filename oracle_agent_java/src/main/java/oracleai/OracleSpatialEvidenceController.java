package oracleai;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/inventory")
public class OracleSpatialEvidenceController {

    private final OracleSpatialEvidenceService spatialEvidenceService;

    public OracleSpatialEvidenceController(OracleSpatialEvidenceService spatialEvidenceService) {
        this.spatialEvidenceService = spatialEvidenceService;
    }

    @GetMapping(path = "/spatial-hotspots", produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> getSpatialHotspots(
            @RequestParam(name = "sku", defaultValue = "SKU-500") String sku
    ) throws Exception {
        OracleSpatialEvidenceService.SpatialEvidence evidence = spatialEvidenceService.fetch(sku);
        return toResponse(evidence);
    }

    @GetMapping(path = "/catalog", produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> catalog() throws Exception {
        return spatialEvidenceService.catalog();
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<?> invalidSku(IllegalArgumentException error) {
        return ResponseEntity.badRequest().body(Map.of("code", "INVALID_SKU", "error", error.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> unavailable(Exception error) {
        return ResponseEntity.status(502).body(Map.of("code", "ORACLE_AGENT_EVIDENCE_UNAVAILABLE",
                "error", "Managed Oracle agent evidence is unavailable or failed validation. "
                + "This does not establish that the SKU is absent, safe, or misconfigured. "
                + "Do not substitute Toolkit data or invent a cause."));
    }

    static Map<String, Object> toResponse(OracleSpatialEvidenceService.SpatialEvidence evidence) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("source", evidence.source());
        response.put("sku", evidence.sku());
        response.put("hotspots", evidence.hotspots());
        response.put("route", evidence.route());
        response.put("sourceDetail", evidence.sourceDetail());
        response.put("executionMode", evidence.executionMode());
        response.put("status", evidence.status());
        response.put("scope", evidence.scope());
        response.put("taskId", evidence.taskId());
        response.put("query", evidence.query());
        response.put("riskMetric", "HOTSPOT_SCORE");
        response.put("riskScale", "0–1 score, not a probability");
        response.put("routeKind", "schematic-source-destination-link");
        response.put("interpretation", evidence.summaryText());
        return response;
    }
}
