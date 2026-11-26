#!/usr/bin/env bash
# Stop the sample stack.
set -euo pipefail
docker compose -f docker/compose.yaml down
