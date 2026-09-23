# Repository guidance

This standalone repository contains the Oracle AI Database and Google Gemini demo.
Start with README.md and the runbook for the component you are changing.

- The Java/Spring Boot runtime in `oracle_agent_java/` is the primary demo implementation.
- Python, Go, MCP, proxy, SQL, deployment, notebook, documentation, and media source folders are retained.
- Shared local configuration is in the root `.env`; use `.env_example` as the template.
- Keep credentials, wallets, runtime downloads, and generated build artifacts out of commits.
- Run local checks appropriate to changed components. Live integration scripts require configured services.
- Existing cloud and database deployments are external to this checkout; relocating the repository does not redeploy them.

## Included skills

The repository includes the complete `video-blog-walkthrough` skill package:
`skills/video-blog-walkthrough/SKILL.md`, its agent metadata, and its audit script.
It is also discoverable through `.agents/skills/video-blog-walkthrough`.
Read that skill when working on narrated developer-blog walkthroughs.

A2A agent skills remain in the agent-card JSON files and runtime implementations;
they are application capabilities, distinct from the development skill above.
