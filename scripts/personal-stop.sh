#!/usr/bin/env bash
# Stop the personal stack. Run by the user only.
set -euo pipefail
docker compose --env-file .env.personal -p signalprism-personal -f docker/compose.personal.yml down
