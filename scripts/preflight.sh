#!/usr/bin/env bash

set -u

PASS_COUNT=0
TOTAL_COUNT=0

pass() {
  local msg="$1"
  echo "PASS: ${msg}"
  PASS_COUNT=$((PASS_COUNT + 1))
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
}

fail() {
  local msg="$1"
  echo "FAIL: ${msg}"
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
}

check_non_empty_file() {
  local file="$1"
  if [ -s "$file" ]; then
    pass "$file exists and is non-empty"
  else
    fail "$file missing or empty"
  fi
}

check_package_script() {
  local script_name="$1"
  if [ -f "package.json" ] && grep -Eq '"'"$script_name"'"[[:space:]]*:' package.json; then
    pass "package.json contains script: $script_name"
  else
    fail "package.json missing script: $script_name"
  fi
}

echo "Running CollectWise preflight checks..."
echo

# 1) Required files: exists and non-empty
check_non_empty_file "src/db/init.js"
check_non_empty_file "src/ingest.js"
check_non_empty_file "src/server.js"
check_non_empty_file "src/start.js"
check_non_empty_file "data/atlas_inventory.csv"
check_non_empty_file "agent/retell_agent.json"
check_non_empty_file "docs/coo_email.md"
check_non_empty_file "README.md"
check_non_empty_file "package.json"
check_non_empty_file ".env.example"
check_non_empty_file "Procfile"
check_non_empty_file "railway.toml"

# 2) package.json scripts
check_package_script "start"
check_package_script "ingest"
check_package_script "start:prod"

# 3) README has live Railway URL marker
if [ -f "README.md" ] && grep -qi 'railway\.app' README.md; then
  pass "README contains railway.app"
else
  fail "README missing railway.app"
fi

# 4) CSV has at least 5 data rows (excluding header)
if [ -f "data/atlas_inventory.csv" ]; then
  DATA_ROWS=$(tail -n +2 "data/atlas_inventory.csv" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')
  if [ "${DATA_ROWS}" -ge 5 ]; then
    pass "data/atlas_inventory.csv has at least 5 data rows (${DATA_ROWS})"
  else
    fail "data/atlas_inventory.csv has fewer than 5 data rows (${DATA_ROWS})"
  fi
else
  fail "data/atlas_inventory.csv missing, cannot count data rows"
fi

echo
echo "${PASS_COUNT}/${TOTAL_COUNT} checks passed"

if [ "${PASS_COUNT}" -eq "${TOTAL_COUNT}" ]; then
  exit 0
fi

exit 1