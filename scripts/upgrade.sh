#!/usr/bin/env bash
#
# Upgrade ZeroProof to a newer release without a full reinstall.
#
# Usage:
#   ./scripts/upgrade.sh                Upgrade to the latest published tag.
#   ./scripts/upgrade.sh v1.1.3         Upgrade to a specific tag/branch/SHA.
#   ./scripts/upgrade.sh --check        Show what would happen; don't apply.
#   ./scripts/upgrade.sh --rollback     Roll back to the previous version.
#   ./scripts/upgrade.sh --force-clean  Discard any locally-modified tracked
#                                       files that differ from the target.
#                                       Use after you've reviewed the diff.
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

# Pin the compose project name so upgrades target the same stack regardless
# of which directory this script is invoked from. Without this, running from
# the updater sidecar (cwd /repo) creates a parallel "repo" project and
# conflicts with the existing "zeroproof" containers by name.
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zeroproof}"

CHECK_ONLY=false
ROLLBACK=false
FORCE_CLEAN=false
TARGET=""

for arg in "$@"; do
    case "$arg" in
        --check)       CHECK_ONLY=true ;;
        --rollback)    ROLLBACK=true ;;
        --force-clean) FORCE_CLEAN=true ;;
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

# When upgrade.sh is invoked from inside the updater container (via the
# in-app Apply Update flow), a plain `compose up -d --build` would
# recreate the updater itself — killing this very script mid-execution
# and leaving the stack in the half-recreated state we hit twice on the
# 2026-05-25 LXC. Detect in-container execution and exclude `updater`
# from the recreate target list. The updater stays on its previous
# image until manually restarted or until the next CLI upgrade. A stale
# updater is a far smaller problem than a half-done upgrade.
#
# CLI runs (host bash, no /.dockerenv) leave RECREATE_SERVICES empty so
# `$COMPOSE up -d --build` recreates everything, including updater.
RECREATE_SERVICES=""
if [[ -f /.dockerenv ]]; then
    RECREATE_SERVICES="$($COMPOSE config --services 2>/dev/null | grep -vx 'updater' | tr '\n' ' ')"
    if [[ -z "$RECREATE_SERVICES" ]]; then
        echo -e "${YELLOW}Could not enumerate services; falling back to default recreate (may interrupt this script).${NC}"
    else
        echo "Detected in-container execution — excluding 'updater' from recreate to avoid script suicide."
        echo "Recreate targets: $RECREATE_SERVICES"
    fi
fi

# Remove containers that share our hardcoded `container_name:` values but
# belong to a *different* compose project. They're the long-tail residue
# of the SCP-deploy era when COMPOSE_PROJECT_NAME wasn't pinned: a parallel
# project (e.g. `repo` from /opt/zeroproof's earlier bind-mount path) can
# outlive a botched run, and `compose up` will then explode with:
#   Error response from daemon: Conflict. The container name
#   "/zeroproof-mqtt" is already in use by container "...".
#
# Same-project containers are left alone — `compose up` reconciles them.
# Containers with no compose-project label at all are also left alone:
# they look like operator-managed external state and silently nuking them
# would be a different class of bug. Surface those with a warning so the
# operator can decide.
remove_orphan_containers() {
    [[ -f docker-compose.yml ]] || return 0
    local declared
    declared=$(grep -E '^\s*container_name:\s*' docker-compose.yml | awk '{print $2}' | tr -d '"' | sort -u)
    [[ -z "$declared" ]] && return 0

    local orphans=() unowned=() hex_leftovers=()
    while IFS= read -r name; do
        [[ -z "$name" ]] && continue

        # Hex-prefixed leftovers from a previously failed recreate. When
        # docker can't use the target container_name (because the old
        # container still holds it), it prepends 12 hex chars + underscore
        # — e.g. `e6aa3f9db470_zeroproof-frontend`. These never start and
        # accumulate across failed upgrades. Always safe to remove
        # regardless of project label. The v1.1.16 orphan-cleanup logic
        # only caught foreign-project conflicts, not same-project hex
        # leftovers; we hit four of these on the 2026-05-25 LXC.
        while IFS= read -r leftover; do
            [[ -z "$leftover" ]] && continue
            hex_leftovers+=("$leftover")
        done < <(docker ps -a --format '{{.Names}}' 2>/dev/null \
                 | grep -E "^[a-f0-9]{12}_${name}$" || true)

        local cid proj
        cid=$(docker ps -aq -f "name=^${name}$" 2>/dev/null || true)
        [[ -z "$cid" ]] && continue
        proj=$(docker inspect "$cid" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || echo "")
        if [[ -n "$proj" && "$proj" != "$COMPOSE_PROJECT_NAME" ]]; then
            orphans+=("$cid|$name|$proj")
        elif [[ -z "$proj" ]]; then
            unowned+=("$cid|$name")
        fi
    done <<< "$declared"

    if (( ${#hex_leftovers[@]} > 0 )); then
        echo -e "${YELLOW}Removing hex-prefixed leftovers from failed prior recreates:${NC}"
        for leftover in "${hex_leftovers[@]}"; do
            echo "  $leftover"
            docker rm -f "$leftover" >/dev/null 2>&1 || true
        done
    fi

    if (( ${#unowned[@]} > 0 )); then
        echo -e "${YELLOW}Warning: containers with reserved names exist outside any compose project:${NC}"
        for entry in "${unowned[@]}"; do
            local cid="${entry%%|*}" name="${entry##*|}"
            echo "  $name (id ${cid:0:12}) — not removing; run 'docker rm -f $name' if you want compose to own it."
        done
    fi

    (( ${#orphans[@]} == 0 )) && return 0

    echo -e "${YELLOW}Removing orphan containers from foreign compose projects:${NC}"
    for entry in "${orphans[@]}"; do
        local cid="${entry%%|*}" rest="${entry#*|}"
        local name="${rest%%|*}" proj="${rest#*|}"
        echo "  $name (id ${cid:0:12}, project '$proj')"
        docker rm -f "$cid" >/dev/null
    done
}

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
    remove_orphan_containers
    $COMPOSE up -d --build $RECREATE_SERVICES
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

# Dereference annotated tags to their commit SHA. Without ^{commit}, an
# annotated tag like v1.1.2 resolves to the tag *object* SHA (not the commit
# it points at), and the "already on target" short-circuit below silently
# misfires for every annotated-tag upgrade.
TARGET_SHA="$(git rev-parse "$TARGET^{commit}")"
TARGET_DESC="$(git describe --tags --always "$TARGET_SHA" 2>/dev/null || echo "$TARGET_SHA")"

if [[ "$CURRENT_SHA" == "$TARGET_SHA" ]]; then
    # Drift check: a previous upgrade run may have completed `git checkout`
    # but failed during `docker compose up` (network/port conflicts, image
    # build error, etc.). In that state git points at the new version while
    # the running containers still serve the old one — and a naive retry
    # short-circuits here as "already done", leaving the user stuck.
    # If we can read the running backend's CHANGELOG and it doesn't match
    # what's checked out, converge by re-running `compose up` instead.
    WORKTREE_VERSION="$(grep -m1 -E '^## \[[^]]+\]' CHANGELOG.md 2>/dev/null | sed -E 's/^## \[([^]]+)\].*/\1/' || true)"
    RUNNING_VERSION="$(docker exec zeroproof-backend grep -m1 -E '^## \[[^]]+\]' /repo/CHANGELOG.md 2>/dev/null | sed -E 's/^## \[([^]]+)\].*/\1/' || true)"
    if [[ -n "$WORKTREE_VERSION" && -n "$RUNNING_VERSION" && "$WORKTREE_VERSION" != "$RUNNING_VERSION" ]]; then
        echo -e "${YELLOW}Worktree is at $TARGET_DESC ($WORKTREE_VERSION) but running stack reports $RUNNING_VERSION.${NC}"
        echo "Converging containers to match the worktree..."
        remove_orphan_containers
        $COMPOSE up -d --build $RECREATE_SERVICES
        echo -e "${GREEN}${BOLD}Converged to $TARGET_DESC.${NC}"
        exit 0
    fi
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

# Pre-flight: locally-modified tracked files block `git checkout <tag>`
# with "Your local changes ... would be overwritten by checkout". The
# common path to that state is an in-place SCP hot-patch — a fix gets
# copied onto the host between releases and lands upstream in the next
# release, so the local edit is already redundant. Bailing with git's
# raw stderr in that case leaves operators stuck on the previous version
# until they remember which file they touched.
#
# For each modified tracked file:
#   - If the working-tree bytes already equal what $TARGET would install,
#     the local edit is redundant — discard it from worktree + index so
#     `git checkout` can proceed.
#   - Otherwise: the operator has a genuine local customization. Refuse
#     the upgrade with the offending paths named, and surface
#     `--force-clean` as the explicit override.
#
# --check mode is read-only: prints "Would discard" instead of mutating
# so the operator can verify what the preflight will do.
echo "Checking working tree for locally-modified tracked files..."
DIRTY_FILES="$(git diff --name-only HEAD --)"
DIRTY_BLOCKERS=()
while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    if ! git cat-file -e "$TARGET_SHA:$path" 2>/dev/null; then
        DIRTY_BLOCKERS+=("$path (not in target)")
        continue
    fi
    cur_hash="$(git hash-object -- "$path" 2>/dev/null || echo MISSING)"
    target_hash="$(git rev-parse "$TARGET_SHA:$path")"
    if [[ "$cur_hash" == "$target_hash" ]]; then
        if $CHECK_ONLY; then
            echo "  Would discard local edit to $path (already matches $TARGET — redundant)"
        else
            echo "  Discarding local edit to $path (already matches $TARGET — redundant)"
            git checkout HEAD -- "$path"
        fi
    else
        DIRTY_BLOCKERS+=("$path")
    fi
done <<< "$DIRTY_FILES"

if (( ${#DIRTY_BLOCKERS[@]} > 0 )); then
    if $FORCE_CLEAN; then
        if $CHECK_ONLY; then
            echo -e "${YELLOW}--force-clean: would discard local modifications to:${NC}"
            for entry in "${DIRTY_BLOCKERS[@]}"; do
                echo "  ${entry%% *}"
            done
        else
            echo -e "${YELLOW}--force-clean: discarding local modifications to:${NC}"
            for entry in "${DIRTY_BLOCKERS[@]}"; do
                path="${entry%% *}"
                echo "  $path"
                git checkout HEAD -- "$path" 2>/dev/null || rm -f -- "$path"
            done
        fi
    else
        echo ""
        echo -e "${RED}${BOLD}Cannot upgrade: tracked files have local modifications:${NC}"
        for entry in "${DIRTY_BLOCKERS[@]}"; do
            echo "  $entry"
        done
        echo ""
        echo "These differ from what $TARGET would install. Resolve by either:"
        echo "  - reviewing and committing them upstream, then re-running this script, or"
        echo "  - discarding them locally:"
        for entry in "${DIRTY_BLOCKERS[@]}"; do
            path="${entry%% *}"
            echo "      git -C $ROOT checkout HEAD -- $path"
        done
        echo "  - re-running with --force-clean to discard all of them automatically."
        exit 2
    fi
fi

# Pre-flight: untracked files that also exist in $TARGET will make
# `git checkout` abort with "untracked working tree files would be
# overwritten". The most common case is the bootstrap pattern: a user runs
# this script before the version they're upgrading to had it tracked, so
# `scripts/upgrade.sh` itself is untracked locally yet exists in the target.
# When the local copy is byte-identical to the target's copy, just remove
# it (checkout will reinstate it). Anything else: bail loudly so the user
# decides what to do.
echo ""
echo "Checking working tree for untracked files that conflict with $TARGET..."
TARGET_PATHS="$(git ls-tree -r --name-only "$TARGET_SHA")"
UNTRACKED="$(git ls-files --others --exclude-standard)"
BLOCKERS=()
while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    if grep -Fxq -- "$path" <<< "$TARGET_PATHS"; then
        if git show "$TARGET_SHA:$path" 2>/dev/null | cmp -s - "$path"; then
            if $CHECK_ONLY; then
                echo "  Would remove untracked $path (identical to target — bootstrap reinstall)"
            else
                echo "  Removing untracked $path (identical to target — bootstrap reinstall)"
                rm -f -- "$path"
            fi
        else
            BLOCKERS+=("$path")
        fi
    fi
done <<< "$UNTRACKED"

if (( ${#BLOCKERS[@]} > 0 )); then
    echo ""
    echo -e "${RED}${BOLD}Untracked files would be overwritten by checkout:${NC}"
    for path in "${BLOCKERS[@]}"; do
        echo "  $path"
    done
    echo ""
    echo "Move, delete, or commit these files, then re-run the upgrade."
    exit 1
fi

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

# Restore-on-failure: if anything between the upcoming `git checkout` and
# a successful `compose up` exits non-zero, restore the worktree to where
# we started. Without this, a partial failure leaves git ahead of the
# running stack and a naive retry short-circuits as "already on target"
# (the drift check above is a backstop, not a substitute).
UPGRADE_DONE=false
restore_on_failure() {
    local code=$?
    if [[ $code -ne 0 && "$UPGRADE_DONE" != "true" ]]; then
        local current
        current="$(git rev-parse HEAD 2>/dev/null || echo '')"
        if [[ -n "$current" && "$current" != "$CURRENT_SHA" ]]; then
            echo ""
            echo -e "${YELLOW}Upgrade failed — restoring worktree to $CURRENT_DESC so a retry can proceed.${NC}"
            git checkout --quiet "$CURRENT_SHA" 2>/dev/null || true
        fi
    fi
}
trap restore_on_failure EXIT

echo "Checking out $TARGET..."
git checkout --quiet "$TARGET"

# Sync .env with any new keys introduced by the target version.
# Releases sometimes add new required env vars (UPDATER_SECRET in v1.1.5,
# for example). Existing operators upgraded their working tree but their
# .env stayed frozen at the older shape, so containers crashloop on the
# missing var.
#
# We merge ONLY keys that docker-compose.yml actually interpolates via
# ${KEY} syntax. .env.example carries some dev-reference defaults
# (DATABASE_URL, MQTT_BROKER, etc.) that production compose hardcodes
# in its own `environment:` blocks — appending those to .env was both
# noisy and confusing.
#
# For each missing interpolated key:
#   - *_SECRET / *_PASSWORD / *_KEY get an auto-generated value via
#     /dev/urandom (no openssl dependency — the updater sidecar's
#     Alpine image doesn't ship openssl, so the previous openssl-based
#     generation crashed when the upgrade ran from inside the sidecar).
#   - everything else is appended blank so the operator can fill in.
#
# Operator-set values are never overwritten — the existing-key check
# always wins.
if [[ -f .env && -f .env.example && -f docker-compose.yml ]]; then
    # Extract `${KEY}` and `${KEY:-default}` references from compose into
    # a sorted, deduplicated allowlist. This is the set of vars compose
    # actually reads from .env.
    INTERPOLATED_KEYS="$(
        grep -oE '\$\{[A-Z_][A-Z0-9_]*' docker-compose.yml \
            | sed 's/^\${//' \
            | sort -u
    )"

    NEW_KEYS=()
    while IFS= read -r line; do
        # Skip comments + blank lines + lines without =
        [[ "$line" =~ ^# || -z "$line" || ! "$line" =~ = ]] && continue
        key="${line%%=*}"
        # Skip frontend build-time vars
        [[ "$key" =~ ^VITE_ ]] && continue
        # Skip keys compose doesn't interpolate
        if ! grep -qx -- "$key" <<< "$INTERPOLATED_KEYS"; then
            continue
        fi
        # Already present in .env (uncommented)?
        if grep -qE "^[[:space:]]*${key}=" .env; then
            continue
        fi
        NEW_KEYS+=("$key")
    done < .env.example

    if (( ${#NEW_KEYS[@]} > 0 )); then
        echo ""
        echo "New env vars introduced by $TARGET — appending to .env:"
        {
            echo ""
            echo "# Added automatically during upgrade to $TARGET"
        } >> .env
        # Explicit allowlist of keys we auto-generate values for.
        # Pattern-matching on *_SECRET / *_PASSWORD was too loose and
        # would auto-generate DEFAULT_ADMIN_PASSWORD, which is supposed
        # to stay unset by default (the /setup flow handles admin
        # creation). When we add a new required secret, name it here.
        case_auto_generate() {
            case "$1" in
                POSTGRES_PASSWORD|MQTT_PASSWORD|SESSION_SECRET|ENCRYPTION_KEY|UPDATER_SECRET)
                    return 0 ;;
                *) return 1 ;;
            esac
        }
        for key in "${NEW_KEYS[@]}"; do
            if [[ "$key" == "HOST_WORKTREE" ]]; then
                # The updater bind-mount needs an absolute host path —
                # see the matching block in install.sh. Compute it from
                # the worktree we're upgrading inside.
                value="$(pwd -P)"
                echo "$key=$value" >> .env
                echo "  + $key=$value (auto: current install dir)"
            elif case_auto_generate "$key"; then
                # /dev/urandom + base64 is portable across alpine, debian,
                # and any minimal container without bringing in openssl.
                value="$(head -c 64 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 48)"
                echo "$key=$value" >> .env
                echo "  + $key (generated)"
            else
                echo "$key=" >> .env
                echo "  + $key (blank — set manually if needed)"
            fi
        done
    fi
fi

echo "Rebuilding + restarting containers (this may take a few minutes)..."
remove_orphan_containers
$COMPOSE up -d --build $RECREATE_SERVICES
# Past the dangerous window: containers are now serving the new version.
# A health-check failure below is recoverable with --rollback; we don't
# want the EXIT trap to clobber the worktree on top of that.
UPGRADE_DONE=true

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

    # Reclaim disk used by old image layers and intermediate build
    # stages. The 2026-05-26 LXC ran out of disk (15G/16G) after an
    # upgrade because every release builds new images while old ones
    # accumulate forever — \`docker system df\` showed 9.7G reclaimable
    # in 79 images of which only 7 were in use. We run this AFTER the
    # health check so a busted upgrade doesn't lose its rollback path
    # (rollback re-builds from cache, which dangling layers feed).
    #
    # --keep-storage 1g on the builder leaves enough cache to make the
    # next upgrade's rebuild fast; -af on images removes any image not
    # currently tagged AND not referenced by a running container.
    echo ""
    echo "Reclaiming disk from dangling images + build cache..."
    if docker image prune -af --filter "until=24h" >/tmp/prune-images.log 2>&1 \
        && docker builder prune -af --keep-storage 1g >/tmp/prune-builder.log 2>&1; then
        img_freed=$(grep -E '^Total reclaimed space:' /tmp/prune-images.log | tail -1 || echo "")
        bld_freed=$(grep -E '^Total reclaimed space:' /tmp/prune-builder.log | tail -1 || echo "")
        [[ -n "$img_freed" ]] && echo "  Images: $img_freed"
        [[ -n "$bld_freed" ]] && echo "  Build cache: $bld_freed"
    else
        echo -e "${YELLOW}  (prune failed; not fatal — upgrade is already complete)${NC}"
    fi

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
