package oracleai;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class OracleSpatialEvidenceServiceTest {
    private final OracleAiDatabaseAgentClient client = mock(OracleAiDatabaseAgentClient.class);
    private final OracleSpatialEvidenceService service = new OracleSpatialEvidenceService(
            client, new ObjectMapper(), new MockEnvironment());

    private void response(String rows) throws Exception {
        when(client.answer(anyString())).thenReturn(new OracleAiDatabaseAgentClient.RemoteDatabaseResult(
                rows, "remote-a2a", "test managed agent", "query", List.of(), "task-test"));
    }

    private String row(String sku, int id, String role, double score) {
        return """
                {"PRODUCT_ID":"%s","WAREHOUSE_ID":%d,"WAREHOUSE_CODE":"WH-%d",
                 "WAREHOUSE_NAME":"Warehouse %d","LATITUDE":40,"LONGITUDE":-74,
                 "HOTSPOT_SCORE":%s,"RECOMMENDED_ROLE":"%s"}
                """.formatted(sku, id, id, id, score, role);
    }

    @Test void filtersOnEachProductIdNotAnEnvelope() throws Exception {
        response("{\"rows\":[" + row("SKU-500", 1, "DESTINATION_HOTSPOT", .86) + ","
                + row("SKU-700", 1, "SATELLITE_NODE", .29) + ","
                + row("SKU-900", 1, "SATELLITE_NODE", .28) + ","
                + row("SKU-500", 2, "SOURCE_BUFFER", .31) + "]}");
        var evidence = service.fetch("SKU-500");
        assertEquals(2, evidence.hotspots().size());
        assertEquals(List.of(.86, .31), evidence.hotspots().stream().map(h -> h.riskScore()).toList());
        assertEquals(2, evidence.route().size());
        assertEquals("task-test", evidence.taskId());
        assertTrue(evidence.query().contains("PRODUCT_ID"));
    }

    @Test void validAlphanumericAndMultiHyphenSkusReturnNoDataNot500() throws Exception {
        response("{\"rows\":[]}");
        for (String sku : List.of("SKU-501", "GRID-CTRL", "WATER-SENSE", "SKU-APAC-210")) {
            var evidence = service.fetch(sku);
            assertEquals("NO_DATA", evidence.status());
            assertTrue(evidence.summaryText().contains("unknown"));
        }
        assertEquals("SKU-APAC-210", OracleSpatialEvidenceService.skuFromPrompt("map SKU-APAC-210"));
        assertEquals("GRID-CTRL", OracleSpatialEvidenceService.skuFromPrompt("map GRID-CTRL"));
    }

    @Test void rejectsConflictingWarehouseRowsAndInvalidScores() throws Exception {
        response("{\"rows\":[" + row("SKU-500", 1, "SOURCE_BUFFER", .31) + ","
                + row("SKU-500", 1, "SOURCE_BUFFER", .99) + "]}");
        assertThrows(IllegalStateException.class, () -> service.fetch("SKU-500"));
        response("{\"rows\":[" + row("SKU-500", 1, "SOURCE_BUFFER", 86) + "]}");
        assertThrows(IllegalStateException.class, () -> service.fetch("SKU-500"));
    }

    @Test void rejectsMissingProductIdentityAndQueryFailures() throws Exception {
        response("{\"rows\":[{\"WAREHOUSE_ID\":1}]}");
        assertThrows(IllegalStateException.class, () -> service.fetch("SKU-500"));
        response("{\"error\":\"query failed\"}");
        assertThrows(IllegalStateException.class, () -> service.fetch("SKU-500"));
        response("{\"rows\":[]} trailing prose");
        assertThrows(Exception.class, () -> service.fetch("SKU-500"));
    }

    @Test void catalogIsExplicitlyScoped() throws Exception {
        response("{\"rows\":[{\"PRODUCT_ID\":\"SKU-700\",\"PRODUCT_NAME\":\"Kit\"}]}");
        var catalog = service.catalog();
        assertEquals("FINANCIAL.SC_PRODUCTS", catalog.get("scope"));
        assertEquals(List.of(java.util.Map.of("sku", "SKU-700", "productName", "Kit")), catalog.get("items"));
        verify(client).answer(contains("SELECT PRODUCT_ID, PRODUCT_NAME FROM FINANCIAL.SC_PRODUCTS"));
    }

    @Test void invalidInputDoesNotCallTheAgent() {
        assertThrows(IllegalArgumentException.class, () -> service.fetch("SKU-500'; DELETE"));
        verifyNoInteractions(client);
    }

    @Test void relayAloneIsNotATransferDestination() throws Exception {
        response("{\"rows\":[" + row("SKU-500", 1, "SOURCE_BUFFER", .31) + ","
                + row("SKU-500", 2, "RELAY_NODE", .48) + "]}");
        assertTrue(service.fetch("SKU-500").route().isEmpty());
    }
}
