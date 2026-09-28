# Demo data tables and property graph

Installs the Oracle tables, sample data, spatial inventory data, and property
graph used by the demo. Target schema: `FINANCIAL` in `paulparkdb`.

## Audit and privileges

Run the read-only audit as the target schema:

```bash
sql -S "$DB_USERNAME/$DB_PASSWORD@$DB_DSN" \
  @sql/audit_paulparkdb_demo.sql FINANCIAL
```

As `ADMIN`, run once:

```sql
@sql/admin_prepare_paulparkdb_demo.sql
```

## Create and seed the tables

Reconnect as `FINANCIAL`:

```sql
@sql/setup_supply_chain_graph_schema.sql
@sql/seed_supply_chain_graph_data.sql
@sql/setup_inventory_risk_demo_schema.sql
@sql/seed_inventory_risk_demo_data.sql
```

These create the supply-chain graph objects, inventory-risk tables, warehouse
geography, and deterministic demo data including `SKU-500`.

The scripts are intended to be rerunnable. Review errors and existing-object
messages; do not drop objects in a shared database.

## Verify

```sql
select object_name, object_type, status
from user_objects
where object_name like 'SC_%'
   or object_name = 'SUPPLY_CHAIN_GRAPH'
order by object_type, object_name;
```

For Select AI and the managed agent, see
[ORACLE_AI_DATABASE_AGENT_README.md](ORACLE_AI_DATABASE_AGENT_README.md).
