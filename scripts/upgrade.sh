#!/usr/bin/env bash
#
# Upgrade ZeroProof to a newer release without a full reinstall.
#
# Usage:
#   ./scripts/upgrade.sh                Upgrade to the latest published tag.
#   ./scripts/upgrade.sh v1.1.3         Upgrade to a specific tag/branch/SHA.
#   ./scripts/upgrade.sh --check        Show what would happen; don't apply.
#   ./scripts/upgrade.sh --rollback     Roll back to the previous version.
#   ./scripts/upgrade.sh -h             Print help.
#
# Behavior:
#   1. Records the current commit SHA so you can always undo.
#   2. Fetches the latest tags from origin.
#   3. Checks out the target ref.
#   4. Rebuilds containers via docker compose. The backend's CMD runs
#      `prisma migrate deploy` on first start, so DB migrations are
#      handled automatically.
#   5. Polls https://127.0.0.1/health for up to ~90 seconds.
#   6. If health passes: success.
#      If health fails: prints rollback instructions; the previous
#      version is preserved for one-shot rollback.
#
# Safe to re-run. If you're already on the target, it exits cleanly.

set -euo pipefail

# Pretty colors for an interactive terminal.
if [[ -t 1 ]]; then
    GREEN='\033[0;32m'
    RED='\033[0;31m'
    YELLOW='\033[1;33m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    GREEN='' RED='' YELLOW='' BOLD='' NC=''
fi

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PREV_FILE="$ROOT/.zeroproof-prev-version"

CHECK_ONLY=false
ROLLBACK=false
TARGET=""

for arg in "$@"; do
    case "$arg" in
        --check)    CHECK_ONLY=true ;;
        --rollback) ROLLBACK=true ;;
        -h|--help)
            # Print the leading comment block as help text.
            sed -n '/^# Upgrade/,/^# Safe to re-run/p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        --*)
            echo -e "${RED}Unknown flag: $arg${NC}" >&2
            exit 1
            ;;
        *)
            TARGET="$arg"
            ;;
    esac
done

# Pick the right compose binary up-front so all calls below are consistent.
if docker compose version &> /dev/null; then
    COMPOSE="docker compose"
elif command -v docker-compose &> /dev/null; then
    COMPOSE="docker-compose"
else
    echo -e "${RED}Neither 'docker compose' nor 'docker-compose' found in PATH.${NC}"
    exit 1
fi

CURRENT_SHA="$(git rev-parse HEAD)"
CURRENT_DESC="$(git describe --tags --always 2>/dev/null || echo "$CURRENT_SHA")"

# ---- rollback ---------------------------------------------------------
if $ROLLBACK; then
    if [[ ! -f "$PREV_FILE" ]]; then
        echo -e "${RED}No previous version recorded at $PREV_FILE — nothing to roll back to.${NC}"
        echo "Manually checkout an older ref and run 'docker-compose up -d --build'."
        exit 1
    fi
    PREV_SHA="$(cat "$PREV_FILE")"
    PREV_DESC="$(git describe --tags --always "$PREV_SHA" 2>/dev/null || echo "$PREV_SHA")"
    echo -e "${YELLOW}${BOLD}Rolling back: $CURRENT_DESC → $PREV_DESC${NC}"
    git checkout --quiet "$PREV_SHA"
    $COMPOSE up -d --build
    echo -e "${GREEN}Rolled back to $PREV_DESC. Verify with '$COMPOSE ps'.${NC}"
    rm -f "$PREV_FILE"
    exit 0
fi

# ---- upgrade ----------------------------------------------------------
echo "Fetching tags from origin..."
git fetch --tags --quiet origin

if [[ -z "$TARGET" ]]; then
    TARGET="$(git tag --list 'v*' --sort=-v:refname | head -n 1)"
    if [[ -z "$TARGET" ]]; then
        echo -e "${RED}No release tags found in this repo. Pass a target ref explicitly:${NC}"
        echo "  ./scripts/upgrade.sh v1.2.0"
        exit 1
    fi
    echo "Latest tag: $TARGET"
fi

if ! git rev-parse --verify --quiet "$TARGET" >/dev/null; then
    echo -e "${RED}Target ref '$TARGET' not found.${NC}"
    echo "Available tags:"
    git tag --list 'v*' --sort=-v:refname | head -n 5
    exit 1
fi

TARGET_SHA="$(git rev-parse "$TARGET")"
TARGET_DESC="$(git describe --tags --always "$TARGET_SHA" 2>/dev/null || echo "$TARGET_SHA")"

if [[ "$CURRENT_SHA" == "$TARGET_SHA" ]]; then
    echo -e "${GREEN}Already on $TARGET_DESC. Nothing to do.${NC}"
    exit 0
fi

echo ""
echo -e "${BOLD}Plan${NC}"
echo "  Current:  $CURRENT_DESC ($CURRENT_SHA)"
echo "  Target:   $TARGET_DESC ($TARGET_SHA)"
echo ""
echo "  Changes:"
git log --oneline "$CURRENT_SHA..$TARGET_SHA" 2>/dev/null | sed 's/^/    /' || \
    echo "    (could not compute commit range — divergent history)"
echo ""

if $CHECK_ONLY; then
    echo -e "${YELLOW}--check mode: no changes applied.${NC}"
    echo "Re-run without --check to apply this upgrade."
    exit 0
fi

# Best-effort confirm — skipped under non-interactive (CI / scripted).
if [[ -t 0 ]]; then
    read -r -p "Apply upgrade? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        echo "Cancelled."
        exit 0
    fi
fi

echo "$CURRENT_SHA" > "$PREV_FILE"

echo ""
echo "Checking out $TARGET..."
git checkout --quiet "$TARGET"

echo "Rebuilding + restarting containers (this may take a few minutes)..."
$COMPOSE up -d --build

echo ""
echo "Waiting for backend health (timeout 90s)..."
HEALTHY=false
for i in {1..30}; do
    if curl -sk -o /dev/null --max-time 3 https://127.0.0.1/health 2>/dev/null; then
        HEALTHY=true
        break
    fi
    sleep 3
done

echo ""
if $HEALTHY; then
    echo -e "${GREEN}${BOLD}Upgrade complete: $CURRENT_DESC → $TARGET_DESC${NC}"
    echo ""
    echo "If anything looks off, roll back with:"
    echo "  ./scripts/upgrade.sh --rollback"
    exit 0
fi

echo -e "${RED}${BOLD}Health check failed after 90s.${NC}"
echo ""
$COMPOSE ps || true
echo ""
echo -e "${YELLOW}Recovery options:${NC}"
echo "  1. Show backend logs:        $COMPOSE logs --tail=50 backend"
echo "  2. Roll back automatically:  ./scripts/upgrade.sh --rollback"
echo "  3. Investigate manually:     git status"
exit 1
