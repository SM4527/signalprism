#!/usr/bin/env bash
# Follow sample stack logs.
set -euo pipefail
docker compose -f docker/compose.yaml logs -f --tail 100
