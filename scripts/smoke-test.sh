#!/bin/bash

# ZeroProof Smoke Test
# Validates the golden path after install:
#   services healthy → login → dashboard → import config → analyze → findings exist

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

BASE_URL="${BASE_URL:-https://localhost}"
ADMIN_PASSWORD="${DEFAULT_ADMIN_PASSWORD:-admin123!}"
CURL_OPTS="-sk"  # silent, allow self-signed certs
PASS=0
FAIL=0

pass() {
  echo -e "  ${GREEN}✓${NC} $1"
  PASS=$((PASS + 1))
}

fail() {
  echo -e "  ${RED}✕${NC} $1"
  FAIL=$((FAIL + 1))
}

echo "=================================="
echo "  ZeroProof Smoke Test"
echo "=================================="
echo ""
echo "Target: $BASE_URL"
echo ""

# ---- 1. Wait for services ----
echo "1. Waiting for services..."
TIMEOUT=60
ELAPSED=0
HEALTHY=false

while [ $ELAPSED -lt $TIMEOUT ]; do
  if curl $CURL_OPTS "$BASE_URL/health" 2>/dev/null | grep -q '"healthy"'; then
    HEALTHY=true
    break
  fi
  sleep 3
  ELAPSED=$((ELAPSED + 3))
done

if [ "$HEALTHY" = true ]; then
  pass "Health endpoint responds"
else
  fail "Health endpoint not reachable after ${TIMEOUT}s"
  echo -e "${RED}Cannot continue without healthy services.${NC}"
  exit 1
fi

# ---- 2. Login ----
echo "2. Authentication..."
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR" "$CONFIG_FILE"' EXIT

LOGIN_RESPONSE=$(curl $CURL_OPTS -X POST "$BASE_URL/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}" \
  -c "$COOKIE_JAR" 2>/dev/null)

if echo "$LOGIN_RESPONSE" | grep -q '"success":true'; then
  pass "Login with admin credentials"
else
  fail "Login failed: $LOGIN_RESPONSE"
  echo -e "${RED}Cannot continue without authentication.${NC}"
  exit 1
fi

# ---- 3. Dashboard ----
echo "3. Dashboard..."
DASHBOARD_RESPONSE=$(curl $CURL_OPTS -b "$COOKIE_JAR" "$BASE_URL/api/v1/dashboard" 2>/dev/null)

if echo "$DASHBOARD_RESPONSE" | grep -q '"success":true'; then
  pass "Dashboard endpoint responds"
else
  fail "Dashboard failed: $DASHBOARD_RESPONSE"
fi

# ---- 4. Import test config ----
echo "4. Config import..."
CONFIG_FILE=$(mktemp)
cat > "$CONFIG_FILE" << 'CONFIGEOF'
{
  "version": "9.2.17",
  "site": { "name": "Smoke Test Site" },
  "networks": [
    { "_id": "net-main", "name": "Main", "purpose": "corporate", "vlan_enabled": false },
    { "_id": "net-iot", "name": "IoT Devices", "purpose": "corporate", "vlan_enabled": true, "vlan": 20, "network_isolation": false }
  ],
  "firewallRules": [
    { "_id": "fw-any", "name": "Allow All", "enabled": true, "action": "accept", "protocol": "all", "ruleset": "LAN_IN", "rule_index": 1 }
  ],
  "wlans": [
    { "_id": "wlan-main", "name": "Home WiFi", "enabled": true, "security": "wpapsk", "wpa_mode": "wpa2", "is_guest": false }
  ],
  "portForwards": [
    { "_id": "pf-rdp", "name": "RDP Forward", "enabled": true, "dst_port": "3389", "fwd": "192.168.1.100", "fwd_port": "3389", "proto": "tcp" }
  ],
  "settings": {}
}
CONFIGEOF

IMPORT_RESPONSE=$(curl $CURL_OPTS -b "$COOKIE_JAR" -X POST "$BASE_URL/api/v1/config/import" \
  -F "config=@$CONFIG_FILE;filename=smoke-test.json" 2>/dev/null)

if echo "$IMPORT_RESPONSE" | grep -q '"success":true'; then
  pass "Config imported successfully"
else
  fail "Config import failed: $IMPORT_RESPONSE"
fi

# ---- 5. Run security analysis ----
echo "5. Security analysis..."
ANALYSIS_RESPONSE=$(curl $CURL_OPTS -b "$COOKIE_JAR" -X POST "$BASE_URL/api/v1/security/analyze" \
  -H "Content-Type: application/json" \
  -d '{"saveFindings": true}' 2>/dev/null)

if echo "$ANALYSIS_RESPONSE" | grep -q '"success":true'; then
  pass "Security analysis completed"
else
  fail "Security analysis failed: $ANALYSIS_RESPONSE"
fi

# ---- 6. Verify findings ----
echo "6. Verifying findings..."

# Check that findings exist (failed > 0)
FAILED_COUNT=$(echo "$ANALYSIS_RESPONSE" | grep -o '"failed":[0-9]*' | head -1 | cut -d: -f2)
if [ -n "$FAILED_COUNT" ] && [ "$FAILED_COUNT" -gt 0 ]; then
  pass "Analysis produced findings (failed=$FAILED_COUNT)"
else
  fail "Analysis produced no findings — expected at least 1"
fi

# Check for specific rules
if echo "$ANALYSIS_RESPONSE" | grep -q "IS-FW-001"; then
  pass "IS-FW-001 (any-any firewall rule) detected"
else
  fail "IS-FW-001 not found in analysis"
fi

if echo "$ANALYSIS_RESPONSE" | grep -q "IS-PORT-001"; then
  pass "IS-PORT-001 (sensitive port forward) detected"
else
  fail "IS-PORT-001 not found in analysis"
fi

if echo "$ANALYSIS_RESPONSE" | grep -q "IS-VLAN-001"; then
  pass "IS-VLAN-001 (IoT not isolated) detected"
else
  fail "IS-VLAN-001 not found in analysis"
fi

# ---- 7. Intent networks endpoint ----
echo "7. Intent system..."
INTENT_RESPONSE=$(curl $CURL_OPTS -b "$COOKIE_JAR" "$BASE_URL/api/v1/intent/networks" 2>/dev/null)

if echo "$INTENT_RESPONSE" | grep -q '"success":true'; then
  pass "Intent networks endpoint responds"
else
  fail "Intent networks failed: $INTENT_RESPONSE"
fi

# Check that networks are populated (not empty)
if echo "$INTENT_RESPONSE" | grep -q '"_id"'; then
  pass "Intent networks contain data after import"
else
  fail "Intent networks are empty — config key normalization may be broken"
fi

# ---- 8. Timeline endpoints ----
echo "8. Timeline..."
STATS_RESPONSE=$(curl $CURL_OPTS -b "$COOKIE_JAR" "$BASE_URL/api/v1/timeline/stats" 2>/dev/null)

if echo "$STATS_RESPONSE" | grep -q '"success":true'; then
  pass "Timeline stats endpoint responds"
else
  fail "Timeline stats failed: $STATS_RESPONSE"
fi

HISTOGRAM_RESPONSE=$(curl $CURL_OPTS -b "$COOKIE_JAR" "$BASE_URL/api/v1/timeline/histogram?days=0" 2>/dev/null)

if echo "$HISTOGRAM_RESPONSE" | grep -q '"success":true'; then
  pass "Timeline histogram (all-time) endpoint responds"
else
  fail "Timeline histogram failed: $HISTOGRAM_RESPONSE"
fi

# ---- 9. Logout ----
echo "9. Session management..."
LOGOUT_RESPONSE=$(curl $CURL_OPTS -b "$COOKIE_JAR" -X POST "$BASE_URL/api/v1/auth/logout" 2>/dev/null)

if echo "$LOGOUT_RESPONSE" | grep -q '"success":true'; then
  pass "Logout successful"
else
  fail "Logout failed: $LOGOUT_RESPONSE"
fi

# Verify session is invalidated
ME_RESPONSE=$(curl $CURL_OPTS -b "$COOKIE_JAR" "$BASE_URL/api/v1/auth/me" 2>/dev/null)

if echo "$ME_RESPONSE" | grep -q '"UNAUTHORIZED"'; then
  pass "Session invalidated after logout"
else
  fail "Session still valid after logout"
fi

# ---- Summary ----
echo ""
echo "=================================="
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}All $TOTAL checks passed${NC}"
  echo "=================================="
  exit 0
else
  echo -e "${RED}$FAIL of $TOTAL checks failed${NC}"
  echo "=================================="
  exit 1
fi
