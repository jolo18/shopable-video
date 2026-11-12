#!/usr/bin/env bash
# Deploys the app, worker and ingest to Cloud Run with Cloud SQL (plan,
# decision 3). Run from the repo root after `gcloud auth login`.
#
# Needs these environment variables:
#   PROJECT_ID           GCP project
#   REGION               e.g. us-central1
#   SQL_INSTANCE         Cloud SQL instance connection name (project:region:instance)
#   SHOPIFY_APP_URL      public URL of the app service (after the first deploy)
# Secrets in Secret Manager (create once, see docs/deploy.md):
#   sv-database-url, sv-shopify-api-key, sv-shopify-api-secret, sv-import-provider-key
set -euo pipefail

: "${PROJECT_ID:?}" "${REGION:?}" "${SQL_INSTANCE:?}"
REPO="${REGION}-docker.pkg.dev/${PROJECT_ID}/shopable-video"
TAG="$(git rev-parse --short HEAD)"
SCOPES="write_files,write_metaobjects,write_products,write_pixels,read_customer_events,unauthenticated_read_metaobjects,unauthenticated_read_product_listings"

for target in app worker ingest; do
  docker build --target "$target" -t "${REPO}/${target}:${TAG}" .
  docker push "${REPO}/${target}:${TAG}"
done

COMMON_SECRETS="DATABASE_URL=sv-database-url:latest,SHOPIFY_API_KEY=sv-shopify-api-key:latest,SHOPIFY_API_SECRET=sv-shopify-api-secret:latest"

gcloud run deploy sv-ingest \
  --project "$PROJECT_ID" --region "$REGION" \
  --image "${REPO}/ingest:${TAG}" \
  --add-cloudsql-instances "$SQL_INSTANCE" \
  --set-secrets "DATABASE_URL=sv-database-url:latest" \
  --allow-unauthenticated --min-instances 1 --concurrency 200 --memory 256Mi

INGEST_URL="$(gcloud run services describe sv-ingest --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')"

gcloud run deploy sv-app \
  --project "$PROJECT_ID" --region "$REGION" \
  --image "${REPO}/app:${TAG}" \
  --add-cloudsql-instances "$SQL_INSTANCE" \
  --set-secrets "$COMMON_SECRETS" \
  --set-env-vars "SCOPES=${SCOPES},INGEST_URL=${INGEST_URL},SHOPIFY_APP_URL=${SHOPIFY_APP_URL:-},BILLING_TEST=${BILLING_TEST:-false}" \
  --allow-unauthenticated --min-instances 1 --memory 512Mi

# The worker polls the queue, so it needs CPU even without requests.
gcloud run deploy sv-worker \
  --project "$PROJECT_ID" --region "$REGION" \
  --image "${REPO}/worker:${TAG}" \
  --add-cloudsql-instances "$SQL_INSTANCE" \
  --set-secrets "${COMMON_SECRETS},IMPORT_PROVIDER_API_KEY=sv-import-provider-key:latest" \
  --set-env-vars "SCOPES=${SCOPES},INGEST_URL=${INGEST_URL},SHOPIFY_APP_URL=${SHOPIFY_APP_URL:-},IMPORT_PROVIDER=${IMPORT_PROVIDER:-fake}" \
  --no-allow-unauthenticated --no-cpu-throttling --min-instances 1 --max-instances 3 --memory 1Gi

echo "Ingest: ${INGEST_URL}"
echo "App:    $(gcloud run services describe sv-app --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')"
