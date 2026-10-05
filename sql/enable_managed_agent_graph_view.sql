-- Run as FINANCIAL from SQLcl on the GCP VM, after authorization.
-- Capture stdout in a protected operator log OUTSIDE Git: BEFORE_OBJECT_LIST
-- is the rollback value for this one profile attribute. No credentials printed.
-- Adds only the GRAPH_TABLE-backed view; direct graphs cannot share a table/view profile.
-- Does not change the active profile, model, credentials, tables or graph data.
set echo off verify off serveroutput on size unlimited
whenever sqlerror exit sql.sqlcode rollback
declare
    l_profile varchar2(128);
    l_before clob;
    l_objects json_array_t;
    l_item json_object_t;
    l_exists number;
begin
    if sys_context('USERENV', 'SESSION_USER') <> 'FINANCIAL' then
        raise_application_error(-20001, 'Connect as FINANCIAL.');
    end if;
    select count(*) into l_exists from user_objects
      where object_name = 'SC_SUPPLY_CHAIN_GRAPH_V' and object_type = 'VIEW' and status = 'VALID';
    if l_exists <> 1 then
        raise_application_error(-20002, 'Valid SC_SUPPLY_CHAIN_GRAPH_V required; create the graph-backed view first.');
    end if;
    select value into l_profile from selectai_agent_config
      where agent = 'ORACLE_AI_DATABASE_AGENT' and key = 'AGENT_AI_PROFILE';
    select attribute_value into l_before from user_cloud_ai_profile_attributes
      where profile_name = l_profile and attribute_name = 'object_list';
    dbms_output.put_line('PROFILE=' || l_profile);
    dbms_output.put_line('BEFORE_OBJECT_LIST=' || l_before);
    l_objects := json_array_t.parse(l_before);
    for i in 0 .. l_objects.get_size - 1 loop
        l_item := treat(l_objects.get(i) as json_object_t);
        if upper(l_item.get_string('owner')) = 'FINANCIAL'
           and upper(l_item.get_string('name')) = 'SC_SUPPLY_CHAIN_GRAPH_V' then
            dbms_output.put_line('UNCHANGED: graph-backed view already included.');
            return;
        end if;
    end loop;
    l_objects.append(json_object_t('{"owner":"FINANCIAL","name":"SC_SUPPLY_CHAIN_GRAPH_V"}'));
    dbms_cloud_ai.set_attribute(profile_name => l_profile,
        attribute_name => 'object_list', attribute_value => l_objects.to_clob);
    dbms_output.put_line('UPDATED: added only FINANCIAL.SC_SUPPLY_CHAIN_GRAPH_V.');
end;
/
