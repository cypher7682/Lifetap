#!/usr/bin/env bash
# The table server is deployed by Argo CD from cypher7682/cluster-control (charts/lifetap).
# This copies the server code into that repo's chart; commit and push there to roll it out.
#   scripts/sync-cluster-control.sh /path/to/cluster-control
set -euo pipefail
cd "$(dirname "$0")/.."
dest="${1:?usage: $0 /path/to/cluster-control}/charts/lifetap/files"
[ -d "$dest" ] || { echo "no $dest — is that a cluster-control checkout?" >&2; exit 1; }
cp server/server.mjs public/js/table.js "$dest/"
git -C "$dest" status --short -- . || true
echo "Copied. Commit and push cluster-control; Argo restarts the pod when the code changes."
