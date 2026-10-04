package oracleai;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.MediaType;
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

    static Map<String, Object> toResponse(OracleSpatialEvidenceService.SpatialEvidence evidence) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("source", evidence.source());
        response.put("sku", evidence.sku());
        response.put("hotspots", evidence.hotspots());
        response.put("route", evidence.route());
        response.put("sourceDetail", evidence.sourceDetail());
        response.put("executionMode", evidence.executionMode());
        return response;
    }
}
