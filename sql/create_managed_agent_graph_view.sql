-- Install once as FINANCIAL on the GCP VM after authorization.
-- CREATE VIEW deliberately refuses to replace an existing object.
-- No table/graph rows are changed. The managed-agent runtime remains A2A-only.
set echo off verify off
whenever sqlerror exit sql.sqlcode rollback
begin
 if sys_context('USERENV','SESSION_USER') <> 'FINANCIAL' then
  raise_application_error(-20001,'Connect as FINANCIAL.');
 end if;
end;
/
CREATE VIEW FINANCIAL.SC_SUPPLY_CHAIN_GRAPH_V AS
SELECT * FROM GRAPH_TABLE (FINANCIAL.SUPPLY_CHAIN_GRAPH
              MATCH (s IS supplier)-[e1 IS supplies]->(p IS plant)
                -[e2 IS ships_via]->(po IS port)-[e3 IS routes_to]->(w IS warehouse)
                -[e4 IS stocks]->(pr IS product)
              WHERE s.active_flag = 'Y' AND p.active_flag = 'Y' AND po.active_flag = 'Y'
                AND w.active_flag = 'Y' AND pr.active_flag = 'Y'
                AND e1.is_current = 'Y' AND e2.is_current = 'Y'
                AND e3.is_current = 'Y' AND e4.is_current = 'Y'
              COLUMNS (s.supplier_id AS supplier_id, s.supplier_name AS supplier_name,
                p.plant_id AS plant_id, p.plant_name AS plant_name,
                po.port_id AS port_id, po.port_name AS port_name,
                w.warehouse_id AS warehouse_id, w.warehouse_name AS warehouse_name,
                pr.product_id AS product_id, pr.product_name AS product_name,
                CAST(NULL AS NUMBER) AS alert_id, CAST(NULL AS VARCHAR2(200)) AS alert_name))
            UNION ALL
            SELECT * FROM GRAPH_TABLE (FINANCIAL.SUPPLY_CHAIN_GRAPH
              MATCH (s IS supplier)-[e1 IS supplies]->(p IS plant)
                -[e2 IS ships_via]->(po IS port)-[e3 IS routes_to]->(w IS warehouse)
                -[e4 IS stocks]->(pr IS product), (a IS alert)-[e5 IS affects]->(po)
              WHERE s.active_flag = 'Y' AND p.active_flag = 'Y' AND po.active_flag = 'Y'
                AND w.active_flag = 'Y' AND pr.active_flag = 'Y' AND a.active_flag = 'Y'
                AND e1.is_current = 'Y' AND e2.is_current = 'Y' AND e3.is_current = 'Y'
                AND e4.is_current = 'Y' AND e5.is_current = 'Y'
              COLUMNS (s.supplier_id AS supplier_id, s.supplier_name AS supplier_name,
                p.plant_id AS plant_id, p.plant_name AS plant_name,
                po.port_id AS port_id, po.port_name AS port_name,
                w.warehouse_id AS warehouse_id, w.warehouse_name AS warehouse_name,
                pr.product_id AS product_id, pr.product_name AS product_name,
                a.alert_id AS alert_id, a.alert_name AS alert_name));

SELECT product_id, COUNT(*) AS path_rows FROM FINANCIAL.SC_SUPPLY_CHAIN_GRAPH_V
GROUP BY product_id ORDER BY product_id;
