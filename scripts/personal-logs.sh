#!/usr/bin/env bash
# Follow personal stack logs. Run by the user only.
set -euo pipefail
docker compose --env-file .env.personal -p signalprism-personal -f docker/compose.personal.yml logs -f --tail 100
