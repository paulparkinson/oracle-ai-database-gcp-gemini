-- Read-only operator verification. Replace the example context with the gateway's
-- contextId (Oracle UUID), not its A2A taskId. Run as FINANCIAL using SQLcl.
set long 100000 longchunksize 100000 linesize 240 pagesize 100
variable oracle_context varchar2(64)
begin
  :oracle_context := 'REPLACE_WITH_ORACLE_CONTEXT_ID';
end;
/
SELECT team_exec_id, conversation_id, state, start_date, end_date
FROM user_ai_agent_team_history
WHERE conversation_id = :oracle_context;

SELECT invocation_id, team_exec_id, tool_name, start_date, output
FROM user_ai_agent_tool_history
WHERE team_exec_id IN (
  SELECT team_exec_id FROM user_ai_agent_team_history
  WHERE conversation_id = :oracle_context)
AND tool_name = 'SQL_TOOL'
ORDER BY start_date;

-- OUTPUT contains JSON: result is another JSON string with sql_query/sql_result.
-- Inspect actual query success and returned IDs; status=success alone is insufficient.
SELECT text FROM user_views WHERE view_name = 'SC_SUPPLY_CHAIN_GRAPH_V';
SELECT object_name, object_type, status FROM user_objects
WHERE object_name IN ('SUPPLY_CHAIN_GRAPH', 'SC_SUPPLY_CHAIN_GRAPH_V');
SELECT * FROM FINANCIAL.SC_SUPPLY_CHAIN_GRAPH_V ORDER BY product_id, alert_id;
