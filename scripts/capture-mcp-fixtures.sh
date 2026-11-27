#!/usr/bin/env bash
# Capture /api/mcp/* responses from the running SAMPLE stack (:8500) into tests/fixtures/mcp/ for prism-mcp.
set -euo pipefail
base=http://127.0.0.1:8500/api/mcp
out=tests/fixtures/mcp
mkdir -p "$out"
curl -fsS "$base/status" > "$out/status.json"
curl -fsS "$base/signals?days=400" > "$out/signals.json"
curl -fsS "$base/signals?days=400&includePlan=true" > "$out/signals-with-plan.json"
curl -fsS "$base/clusters?days=400" > "$out/clusters.json"
ticker=$(sed -n 's/.*"ticker":"\([A-Z.-]*\)".*/\1/p' "$out/signals.json" | head -1)
curl -fsS "$base/ticker/$ticker" > "$out/ticker-$ticker.json"
echo "captured status, signals, clusters, ticker-$ticker"
