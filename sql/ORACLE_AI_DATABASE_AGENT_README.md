# Select AI and Oracle AI Database Agent

Configures database-side Select AI and installs Oracle's managed Oracle AI
Database Agent team used by Gemini Enterprise.

Prerequisites: complete [DATA_TABLES_README.md](DATA_TABLES_README.md), run
the ADMIN preparation script, and connect as `FINANCIAL` for the remaining
scripts. Keep API keys, wallets, and passwords outside Git.

## Configure one Select AI provider

Do not run both providers unless both profiles are intentionally required.

### OpenAI

```bash
sql -S "$DB_USERNAME/$DB_PASSWORD@$DB_DSN" \
  @sql/create_openai_select_ai_credential.sql "$OPENAI_API_KEY"
```

Then, as `FINANCIAL`:

```sql
@sql/create_paulparkdb_openai_select_ai_profile.sql
```

This creates `OPENAI_CRED` and the narrow
`PAULPARK_SUPPLY_CHAIN_OPENAI` profile.

### Google AI Studio

As `FINANCIAL`:

```sql
@sql/create_google_select_ai_credential.sql
@sql/create_paulparkdb_select_ai_profile.sql
```

The credential script prompts for the API key without echoing it. This creates
`GOOGLE_AI_CRED` and `PAULPARK_SUPPLY_CHAIN_DEMO`.

## Fetch Oracle's official installer

Use the pinned Oracle source revision:

```bash
git clone --filter=blob:none --no-checkout \
  https://github.com/oracle-devrel/oracle-autonomous-database-samples.git \
  /tmp/oracle-autonomous-database-samples
cd /tmp/oracle-autonomous-database-samples
git sparse-checkout init --cone
git sparse-checkout set google-gemini-marketplace-agents/oracle_ai_database_agent
git checkout --detach 7c61fc86ffb7f0f548bdba32ae53ce46ea876fa2
cd google-gemini-marketplace-agents/oracle_ai_database_agent
sha256sum oracle_ai_database_agent.sql oracle_ai_database_agent_tool.sql
```

Compare the checksums with the values in
[docs/ADB_PM_PROD_REDEPLOYMENT.md](../docs/ADB_PM_PROD_REDEPLOYMENT.md).

## Install and verify the managed agent

Run the official scripts in this order, supplying `FINANCIAL` and the selected
narrow profile when prompted:

```sql
@/tmp/oracle-autonomous-database-samples/google-gemini-marketplace-agents/oracle_ai_database_agent/oracle_ai_database_agent_tool.sql
@/tmp/oracle-autonomous-database-samples/google-gemini-marketplace-agents/oracle_ai_database_agent/oracle_ai_database_agent.sql
@sql/verify_oracle_ai_database_agent.sql
```

The installer creates the `ORACLE_AI_DATABASE_AGENT` team. Verification should
show `SQL_TOOL`, `DISTINCT_VALUES_CHECK`, `RANGE_VALUES_CHECK`, and
`GENERATE_CHART`.

Database installation does not register Gemini Enterprise. Complete the A2A
feature-tag, OAuth, Marketplace, and user authorization steps in
[docs/ADB_PM_PROD_REDEPLOYMENT.md](../docs/ADB_PM_PROD_REDEPLOYMENT.md).
