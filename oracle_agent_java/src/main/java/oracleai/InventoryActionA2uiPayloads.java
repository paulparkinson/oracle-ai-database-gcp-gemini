package oracleai;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Builds native, declarative A2UI controls for a draft inventory transfer. */
final class InventoryActionA2uiPayloads {

    static final String VERSION = "v0.8";
    static final String STANDARD_CATALOG =
            "https://a2ui.org/specification/v0_8/standard_catalog_definition.json";
    static final String EXTENSION_URI = "https://a2ui.org/a2a-extension/a2ui/v0.8";
    static final String MIME_TYPE = "application/json+a2ui";

    private InventoryActionA2uiPayloads() {
    }

    static List<Map<String, Object>> transferReviewMessages(
            InventoryActionAdkService.InventoryActionResult result
    ) {
        Map<String, Object> draft = result.draftAction() == null ? Map.of() : result.draftAction();
        Map<String, Object> policy = result.policyResult() == null ? Map.of() : result.policyResult();
        String surfaceId = "inventory-transfer-review-" + UUID.randomUUID();
        String productId = value(draft, "productId", "Inventory transfer");
        String draftId = value(draft, "draftActionId", "draft-not-created");
        String transfer = value(draft, "units", "0") + " units from "
                + value(draft, "sourceWarehouse", "Unknown source") + " to "
                + value(draft, "destinationWarehouse", "Unknown destination");
        String approval = value(policy, "policySummary", value(draft, "approvalState", "Standard review"));

        List<Map<String, Object>> components = List.of(
                component("root", "Column", Map.of("children", explicitList(List.of(
                        "title", "draft-card", "policy-card", "note", "approve", "cancel"
                )))),
                text("title", "Inventory transfer review for " + productId, "h2"),
                component("draft-card", "Card", Map.of("child", "draft-content")),
                component("draft-content", "Column", Map.of("children", explicitList(List.of(
                        "draft-title", "transfer", "draft-id", "execution-state"
                )))),
                text("draft-title", "Proposed move", "h3"),
                text("transfer", transfer),
                text("draft-id", "Draft action: " + draftId, "caption"),
                text("execution-state", "This is a draft only. No inventory movement has been executed.", "caption"),
                component("policy-card", "Card", Map.of("child", "policy-content")),
                component("policy-content", "Column", Map.of("children", explicitList(List.of(
                        "policy-title", "policy-summary"
                )))),
                text("policy-title", "Approval policy", "h3"),
                text("policy-summary", approval),
                text("note", "Choose an action to send a review intent back to the agent; a separate governed workflow must approve and execute any move.", "caption"),
                button("approve", "Request approval", "requestInventoryTransferApproval", draftId),
                text("approve-text", "Request approval"),
                button("cancel", "Cancel draft", "cancelInventoryTransferDraft", draftId),
                text("cancel-text", "Cancel draft")
        );

        return List.of(
                Map.of("beginRendering", Map.of("surfaceId", surfaceId, "root", "root")),
                Map.of("surfaceUpdate", Map.of("surfaceId", surfaceId, "components", components))
        );
    }

    static Map<String, Object> extensionParams() {
        return Map.of("supportedCatalogIds", List.of(STANDARD_CATALOG));
    }

    private static Map<String, Object> button(String id, String label, String actionName, String draftId) {
        return component(id, "Button", Map.of(
                "child", id + "-text",
                "primary", "approve".equals(id),
                "action", Map.of("name", actionName, "context", List.of(context("draftActionId", draftId)))
        ));
    }

    private static Map<String, Object> text(String id, String value, String usageHint) {
        return component(id, "Text", Map.of(
                "text", Map.of("literalString", value == null ? "" : value),
                "usageHint", usageHint
        ));
    }

    private static Map<String, Object> text(String id, String value) {
        return text(id, value, "body");
    }

    private static Map<String, Object> component(String id, String type, Map<String, Object> properties) {
        Map<String, Object> component = new LinkedHashMap<>();
        component.put("id", id);
        component.put("component", Map.of(type, properties));
        return component;
    }

    private static Map<String, Object> explicitList(List<String> children) {
        return Map.of("explicitList", children);
    }

    private static Map<String, Object> context(String key, String value) {
        return Map.of("key", key, "value", Map.of("literalString", value));
    }

    private static String value(Map<String, Object> values, String key, String fallback) {
        Object value = values.get(key);
        return value == null || value.toString().isBlank() ? fallback : value.toString();
    }
}
