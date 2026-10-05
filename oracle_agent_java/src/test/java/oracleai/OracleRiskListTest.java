package oracleai;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class OracleRiskListTest {
    final OracleAiDatabaseAgentClient client = mock(OracleAiDatabaseAgentClient.class);
    final OracleSpatialEvidenceService service = new OracleSpatialEvidenceService(client, new ObjectMapper(), new MockEnvironment());
    String row(String sku, double probability) {
        return """
            {"PRODUCT_ID":"%s","PRODUCT_NAME":"Product","QUARTER_LABEL":"2026-Q4",
             "OVERALL_RISK_LEVEL":"HIGH","STOCKOUT_PROBABILITY":%s,"PRIMARY_REGION":"Northeast"}
            """.formatted(sku, probability);
    }
    void response(String json) throws Exception {
        when(client.answer(anyString())).thenReturn(new OracleAiDatabaseAgentClient.RemoteDatabaseResult(
            json, "remote-a2a", "managed agent", "query", List.of(), "task", "context"));
    }
    @Test void oneReadRanksActualProductProbabilityNotHotspots() throws Exception {
        response("{\"rows\":[" + row("SKU-700", .49) + "," + row("SKU-500", .72) + "," + row("SKU-500", .72) + "]}");
        var r = service.stockoutRisks();
        assertEquals(List.of("SKU-500", "SKU-700"), r.items().stream().map(i -> i.sku()).toList());
        assertEquals(.72, r.items().get(0).stockoutProbability());
        assertEquals("STOCKOUT_PROBABILITY", r.riskMetric());
        assertEquals("context", r.contextId());
        assertFalse(r.query().contains("HOTSPOT_SCORE"));
        verify(client, times(1)).answer(contains("SELECT DISTINCT PRODUCT_ID, PRODUCT_NAME"));
    }
    @Test void rejectsConflictsAndWrongScale() throws Exception {
        response("{\"rows\":[" + row("SKU-500", .72) + "," + row("SKU-500", .86) + "]}");
        assertThrows(IllegalStateException.class, service::stockoutRisks);
        response("{\"rows\":[" + row("SKU-500", 72) + "]}");
        assertThrows(IllegalStateException.class, service::stockoutRisks);
    }
    @Test void errorsNeverBecomeNoData() throws Exception {
        response("{\"error\":\"failed\"}");
        assertThrows(IllegalStateException.class, service::stockoutRisks);
        response("{\"rows\":[]} extra text");
        assertThrows(Exception.class, service::stockoutRisks);
        response("{\"rows\":[{\"PRODUCT_ID\":\"SKU-500\",\"HOTSPOT_SCORE\":0.86}]}");
        assertThrows(IllegalStateException.class, service::stockoutRisks);
    }
    @Test void emptyAndZeroProbabilityHaveNoPositiveRiskRows() throws Exception {
        response("{\"rows\":[" + row("SKU-500", 0) + "]}");
        assertEquals("NO_DATA", service.stockoutRisks().status());
        response("{\"rows\":[]}");
        assertEquals(0, service.stockoutRisks().totalRows());
    }
    @Test void boundedDisplayAndUpstreamCapAreExplicit() throws Exception {
        var rows = java.util.stream.IntStream.range(0, 21).mapToObj(n -> row("SKU-" + n, .5)).toList();
        response("{\"rows\":[" + String.join(",", rows) + "]}");
        var r = service.stockoutRisks();
        assertEquals(20, r.items().size()); assertEquals(21, r.totalRows()); assertTrue(r.truncated());
        response("{\"rows\":[" + String.join(",", java.util.Collections.nCopies(1000, row("SKU-500", .5))) + "]}");
        assertThrows(IllegalStateException.class, service::stockoutRisks);
    }
}
