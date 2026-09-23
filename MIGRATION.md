# Standalone repository migration

This project moved from `paulparkinson/oracle-ai-for-sustainable-dev`, directory
`oracle-ai-database-gcp-gemini`, to
<https://github.com/paulparkinson/oracle-ai-database-gcp-gemini> on September 23, 2026.

The directory is now the repository root. Project history, the current working
changes, all A2A agent-card skills, the shared repository skill package, and the
Universal Permissive License were retained. Git commit IDs changed during the
history extraction. The monorepo remains the source for original commit IDs.

Local configuration and ignored runtime/media/build files were carried into the
local checkout but are not published. Existing remote deployments were not moved
or restarted. Historical deployment logs retain their original paths.

Clone and enter the new repository with:

```sh
git clone https://github.com/paulparkinson/oracle-ai-database-gcp-gemini.git
cd oracle-ai-database-gcp-gemini
```

Follow README.md for configuration and component-specific build/run instructions.
The application folders retain their relative relationships with `.env`, `sql/`,
and the shared helper scripts.
