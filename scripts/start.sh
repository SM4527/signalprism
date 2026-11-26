#!/usr/bin/env bash
# Start the sample stack on http://127.0.0.1:8500.
set -euo pipefail
docker compose -f docker/compose.yaml up -d --build
