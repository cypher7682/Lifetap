#!/usr/bin/env bash
# Build into dist/ and serve it over HTTPS on the tailnet with `tailscale serve`.
# Service workers need HTTPS, which tailscale serve provides via the *.ts.net cert.
# Re-running only rebuilds dist/; the serve config points at the directory and persists.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/build.py
sudo tailscale serve --bg --https=443 --set-path=/counter-dash "$PWD/dist"
host=$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
echo "Live at https://$host/counter-dash/"
