#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-adb-pm-prod}"
REGION="${REGION:-us-east4}"
REPOSITORY="${REPOSITORY:-a2ui-agents}"
RUNNER_SERVICE_ACCOUNT="${RUNNER_SERVICE_ACCOUNT:-a2ui-gemini-runner@${PROJECT_ID}.iam.gserviceaccount.com}"
ORACLE_RELAY_URL="${ORACLE_RELAY_URL:-https://oracle-private-a2a-relay-54d5grsrkq-uk.a.run.app}"
GATEWAY_SERVICE="${GATEWAY_SERVICE:-oracle-inventory-agent-gateway}"
MCP_SERVICE="${MCP_SERVICE:-oracle-supply-chain-mcp-gemini}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATEWAY_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${GATEWAY_SERVICE}:managed-agent-spatial"
MCP_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${MCP_SERVICE}:managed-agent-spatial"

gcloud builds submit "${ROOT_DIR}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --config="${ROOT_DIR}/deploy/gcp/cloudbuild.oracle-agent.yaml" \
  --substitutions="_IMAGE=${GATEWAY_IMAGE}"

gcloud run deploy "${GATEWAY_SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --platform=managed \
  --image="${GATEWAY_IMAGE}" \
  --service-account="${RUNNER_SERVICE_ACCOUNT}" \
  --allow-unauthenticated \
  --port=8080 \
  --cpu=1 \
  --memory=1Gi \
  --timeout=300 \
  --max-instances=2 \
  --set-env-vars="ORACLE_AI_DATABASE_AGENT_URL=${ORACLE_RELAY_URL}/,ORACLE_AI_DATABASE_AGENT_TOKEN_URL=https://dataaccess.adb.us-ashburn-1.oraclecloudapps.com/adb/auth/v1/connect/token,INVENTORY_SYSTEM_ALLOW_LOCAL_SELECT_AI_FALLBACK=false,INVENTORY_SCHEMA_OWNER=FINANCIAL" \
  --set-secrets="ORACLE_AI_DATABASE_AGENT_CLIENT_ID=oracle-agent-paulparkdb-oauth-client-id:latest,ORACLE_AI_DATABASE_AGENT_CLIENT_SECRET=oracle-agent-paulparkdb-oauth-client-secret:latest,ORACLE_AI_DATABASE_AGENT_REFRESH_TOKEN=oracle-agent-paulparkdb-oauth-refresh-token:latest" \
  --quiet

GATEWAY_URL="$(gcloud run services describe "${GATEWAY_SERVICE}" \
  --project="${PROJECT_ID}" --region="${REGION}" --format='value(status.url)')"

gcloud builds submit "${ROOT_DIR}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --config="${ROOT_DIR}/deploy/gcp/cloudbuild.mcp-app.yaml" \
  --substitutions="_IMAGE=${MCP_IMAGE}"

gcloud run deploy "${MCP_SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --platform=managed \
  --image="${MCP_IMAGE}" \
  --service-account="${RUNNER_SERVICE_ACCOUNT}" \
  --allow-unauthenticated \
  --port=8080 \
  --cpu=2 \
  --memory=2Gi \
  --timeout=300 \
  --max-instances=1 \
  --network=default \
  --subnet=default \
  --vpc-egress=private-ranges-only \
  --set-env-vars="DB_SERVICE_NAME=paulparkdb_tp,DB_USERNAME=FINANCIAL,AGENT_PORT=8081,AGENT_SERVICE_URL=http://127.0.0.1:8081,ORACLE_SPATIAL_EVIDENCE_URL=${GATEWAY_URL}/api/inventory/spatial-hotspots,MCP_BIND_HOST=0.0.0.0,MCP_WRITES_ENABLED=false" \
  --set-secrets="DB_PASSWORD=a2ui-paulparkdb-financial-password:latest,/var/run/secrets/oracle-wallet/wallet.zip=a2ui-paulparkdb-wallet:latest" \
  --quiet

printf 'Oracle-agent gateway: %s\n' "${GATEWAY_URL}"
printf 'MCP App endpoint: %s/mcp\n' "$(gcloud run services describe "${MCP_SERVICE}" --project="${PROJECT_ID}" --region="${REGION}" --format='value(status.url)')"
