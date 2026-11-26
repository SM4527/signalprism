#!/usr/bin/env bash
# Rebuild and restart the sample stack.
set -euo pipefail
docker compose -f docker/compose.yaml down
docker compose -f docker/compose.yaml up -d --build
