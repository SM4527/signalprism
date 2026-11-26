#!/usr/bin/env bash
# Start the personal stack. Run by the user only.
set -euo pipefail
docker compose --env-file .env.personal -p signalprism-personal -f docker/compose.personal.yml up -d --build
