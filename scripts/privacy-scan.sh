#!/usr/bin/env bash
# Fail if committable files leak personal ports, secret values, or personal data paths.
set -uo pipefail
fail=0
files=$(git ls-files --cached --others --exclude-standard | grep -v -E '^(scripts/privacy-scan\.sh|CLAUDE\.md|README\.md|package-lock\.json)$')

check() {
  local label="$1" pattern="$2" scope="${3:-}"
  local hits
  hits=$(echo "$files" | { [ -n "$scope" ] && grep -v -E "$scope" || cat; } | xargs -r grep -n -E "$pattern" 2>/dev/null)
  if [ -n "$hits" ]; then
    echo "PRIVACY: $label"; echo "$hits"; fail=1
  fi
}

check "personal ports" '(^|[^0-9])(8510|8430)([^0-9]|$)'
check "secret values" '(PUSHOVER_APP_TOKEN|PUSHOVER_USER_KEY|SEC_USER_AGENT)[[:space:]]*[=:][[:space:]]*["'"'"']?[A-Za-z0-9]'  '^(src/lib/config\.ts|tests/)'
check "live hosts outside client modules" '(api\.pushover\.net|sec\.gov)' '^(src/lib/(sec|notify)/|tests/)'

tracked=$(git ls-files | grep -E '^(\.env.*|data/local/.*)$' | grep -v '^\.env\.example$')
if [ -n "$tracked" ]; then echo "PRIVACY: tracked personal files"; echo "$tracked"; fail=1; fi

[ "$fail" -eq 0 ] && echo "privacy scan ok"
exit "$fail"
