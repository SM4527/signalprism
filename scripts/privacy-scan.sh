#!/usr/bin/env bash
# Fail if committable files leak personal ports, secret values, or personal data paths.
# Usage: privacy-scan.sh [rev]   no rev: scan the working tree; rev: scan that commit's tree (what a push sends).
set -uo pipefail
rev="${1:-}"
fail=0

if [ -n "$rev" ]; then
  all=$(git ls-tree -r --name-only "$rev")
  grep_files() { xargs -r -d '\n' git grep -n -E "$1" "$rev" -- 2>/dev/null; }
else
  all=$(git ls-files --cached --others --exclude-standard)
  grep_files() { xargs -r -d '\n' grep -n -E "$1" 2>/dev/null; }
fi
files=$(echo "$all" | grep -v -E '^(scripts/privacy-scan\.sh|CLAUDE\.md|README\.md|package-lock\.json)$')

check() {
  local label="$1" pattern="$2" scope="${3:-}"
  local hits
  hits=$(echo "$files" | { [ -n "$scope" ] && grep -v -E "$scope" || cat; } | grep_files "$pattern")
  if [ -n "$hits" ]; then
    echo "PRIVACY: $label"; echo "$hits"; fail=1
  fi
}

check "personal ports" '(^|[^0-9])(8510|8430)([^0-9]|$)'
check "secret values" '(PUSHOVER_APP_TOKEN|PUSHOVER_USER_KEY|SEC_USER_AGENT)[[:space:]]*[=:][[:space:]]*["'"'"']?[A-Za-z0-9]'  '^(src/lib/config\.ts|tests/)'
check "live hosts outside client modules" '(api\.pushover\.net|sec\.gov)' '^(src/lib/(sec|notify)/|tests/)'

if [ -n "$rev" ]; then tracked=$(echo "$all" | grep -E '^(\.env.*|data/local/.*)$' | grep -v '^\.env\.example$')
else tracked=$(git ls-files | grep -E '^(\.env.*|data/local/.*)$' | grep -v '^\.env\.example$'); fi
if [ -n "$tracked" ]; then echo "PRIVACY: tracked personal files"; echo "$tracked"; fail=1; fi

[ "$fail" -eq 0 ] && echo "privacy scan ok${rev:+ ($rev)}"
exit "$fail"
