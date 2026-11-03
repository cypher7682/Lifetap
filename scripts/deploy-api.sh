#!/usr/bin/env bash
# Deploy the table server to the home cluster (tailnet only, via the Tailscale ingress).
# The code ships in a ConfigMap on the stock node image, so there's no image to build.
set -euo pipefail
cd "$(dirname "$0")/.."
K="sudo kubectl"
$K apply -f deploy/k8s/lifetap-api.yaml
$K -n lifetap create configmap lifetap-api-code \
  --from-file=server.mjs=server/server.mjs --from-file=table.js=public/js/table.js \
  --dry-run=client -o yaml | $K apply -f -
$K -n lifetap rollout restart deploy/lifetap-api
$K -n lifetap rollout status deploy/lifetap-api --timeout=180s
host=$($K -n lifetap get ingress lifetap-api -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' || true)
echo "API at https://${host:-<waiting for tailscale>}/api/health"
