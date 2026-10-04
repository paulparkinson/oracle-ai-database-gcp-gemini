package oracleai;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class OracleGraphEvidenceServiceTest {
    private final OracleAiDatabaseAgentClient client = mock(OracleAiDatabaseAgentClient.class);
    private final OracleGraphEvidenceService service = new OracleGraphEvidenceService(client, new ObjectMapper(), new MockEnvironment());
    private String row(String sku, String supplier, String alert) {
        return """
          {"PRODUCT_ID":"%s","PRODUCT_NAME":"Product %s","SUPPLIER_ID":1,"SUPPLIER_NAME":"%s",
           "PLANT_ID":2,"PLANT_NAME":"Plant","PORT_ID":3,"PORT_NAME":"Port",
           "WAREHOUSE_ID":4,"WAREHOUSE_NAME":"Warehouse",%s}
          """.formatted(sku, sku, supplier, alert);
    }
    private void response(String rows) throws Exception {
        when(client.answer(anyString())).thenReturn(new OracleAiDatabaseAgentClient.RemoteDatabaseResult(
            rows, "remote-a2a", "test fixture", "query", List.of(), "test-task"));
    }
    @Test void buildsTypedDeduplicatedGraphWithPerProductIdentity() throws Exception {
        String row = row("SKU-700", "Supplier", "\"ALERT_ID\":5,\"ALERT_NAME\":\"Weather\"");
        response("{\"rows\":[" + row + "," + row + "," + row("SKU-500", "Other", "\"ALERT_ID\":null,\"ALERT_NAME\":null") + "]}");
        var g = service.fetch("sku-700");
        assertEquals(6, g.nodes().size()); assertEquals(5, g.edges().size());
        assertTrue(g.nodes().stream().allMatch(n -> n.sku().equals("SKU-700")));
        assertTrue(g.edges().stream().anyMatch(e -> e.source().equals("alert:5") && e.target().equals("port:3")));
        assertEquals("test-task", g.taskId());
        verify(client).answer(contains("FINANCIAL.SC_SUPPLIER_PLANT"));
    }
    @Test void noAlertDoesNotInventAnAlert() throws Exception {
        response("{\"rows\":[" + row("SKU-700", "Supplier", "\"ALERT_ID\":null,\"ALERT_NAME\":null") + "]}");
        assertEquals(5, service.fetch("SKU-700").nodes().size());
        assertEquals(4, service.fetch("SKU-700").edges().size());
    }
    @Test void unknownSkuIsNoDataNotSafety() throws Exception {
        response("{\"rows\":[]}");
        var g = service.fetch("SKU-501");
        assertEquals("NO_DATA", g.status()); assertTrue(g.edges().isEmpty());
        assertTrue(g.interpretation().contains("does not prove"));
    }
    @Test void rejectsConflictsIncompleteRowsAndFalseEmptyErrors() throws Exception {
        response("{\"rows\":[" + row("SKU-700", "One", "\"ALERT_ID\":null,\"ALERT_NAME\":null") + ","
            + row("SKU-700", "Two", "\"ALERT_ID\":null,\"ALERT_NAME\":null") + "]}");
        assertThrows(IllegalStateException.class, () -> service.fetch("SKU-700"));
        for (String invalid : List.of("{\"rows\":[{\"PRODUCT_ID\":\"SKU-700\"}]}", "{\"error\":\"query failed\"}",
                "{\"rows\":[]} trailing prose", "{\"rows\":[" + row("SKU-700", "Supplier", "\"ALERT_ID\":null,\"ALERT_NAME\":\"Ghost\"") + "]}")) {
            response(invalid); assertThrows(Exception.class, () -> service.fetch("SKU-700"));
        }
    }
    @Test void rejectsOversizeResultsAndMissingTaskId() throws Exception {
        response("{\"rows\":[" + String.join(",", java.util.Collections.nCopies(1001, "{}")) + "]}");
        assertThrows(IllegalStateException.class, () -> service.fetch("SKU-700"));
        when(client.answer(anyString())).thenReturn(new OracleAiDatabaseAgentClient.RemoteDatabaseResult(
            "{\"rows\":[]}", "remote-a2a", "test", "query", List.of(), ""));
        assertThrows(IllegalStateException.class, () -> service.fetch("SKU-700"));
    }
    @Test void invalidSkuNeverReachesAgent() {
        assertThrows(IllegalArgumentException.class, () -> service.fetch("SKU'; DELETE")); verifyNoInteractions(client);
    }
}
