#!/usr/bin/env bash
# The CI image job, runnable locally: build the runtime image, then run watch-add in it in mock mode
# with the fixtures mounted read-only (they are not baked into the image).
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

docker build -f docker/Dockerfile -t signalprism:ci .
out=$(docker run --rm \
  -e DATA_MODE=mock -e DB_PATH=/tmp/ci.db \
  -v "$PWD/tests/fixtures:/app/tests/fixtures:ro" \
  signalprism:ci node scripts/watch-add.ts ACMR)
echo "$out"
grep -q "added: ACMR" <<<"$out"
