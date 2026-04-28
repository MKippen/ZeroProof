#!/bin/bash

# ZeroProof - Backup Script
# Creates a backup of the database and local configuration.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/backup.sh [backup-dir] [--compose-file FILE]

Creates a database dump and a config archive for the currently running
ZeroProof compose stack. The database name is read from the running Postgres
container so local/dev stacks are backed up correctly.

Options:
  -f, --compose-file FILE  Compose file to target, for example docker-compose.dev.yml
  --dev                    Shortcut for --compose-file docker-compose.dev.yml
  -h, --help               Show this help

Environment:
  BACKUP_DB_NAME           Override database name
  BACKUP_DB_USER           Override database user, defaults to postgres
EOF
}

BACKUP_DIR="./backups"
COMPOSE_FILE_ARG=""
BACKUP_DIR_SET=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    -f|--compose-file)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for $1"
        exit 1
      fi
      COMPOSE_FILE_ARG="$2"
      shift 2
      ;;
    --dev)
      COMPOSE_FILE_ARG="docker-compose.dev.yml"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [ "$BACKUP_DIR_SET" = false ]; then
        BACKUP_DIR="$1"
        BACKUP_DIR_SET=true
        shift
      else
        echo "Unexpected argument: $1"
        usage
        exit 1
      fi
      ;;
  esac
done

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="zeroproof-backup-$TIMESTAMP"

if ! docker compose version &> /dev/null; then
  if command -v docker-compose &> /dev/null; then
    COMPOSE_CMD=(docker-compose)
  else
    echo "Docker Compose not found. Please install Docker Desktop or docker-compose."
    exit 1
  fi
else
  COMPOSE_CMD=(docker compose)
fi

COMPOSE_ARGS=()
if [ -n "$COMPOSE_FILE_ARG" ]; then
  COMPOSE_ARGS=(-f "$COMPOSE_FILE_ARG")
fi

compose() {
  "${COMPOSE_CMD[@]}" "${COMPOSE_ARGS[@]}" "$@"
}

# Load env if present.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

DB_USER="${BACKUP_DB_USER:-${POSTGRES_USER:-postgres}}"

if ! compose ps --services --filter status=running 2>/dev/null | grep -qx "postgres"; then
  echo "Postgres service is not running for this compose project."
  if [ -n "$COMPOSE_FILE_ARG" ]; then
    echo "Checked compose file: $COMPOSE_FILE_ARG"
  fi
  echo "Start ZeroProof first, or pass the correct compose file with --compose-file."
  exit 1
fi

RUNNING_DB_NAME=$(compose exec -T postgres sh -lc 'printf "%s" "${POSTGRES_DB:-}"' 2>/dev/null || true)
DB_NAME="${BACKUP_DB_NAME:-${RUNNING_DB_NAME:-${POSTGRES_DB:-zeroproof}}}"

echo "ZeroProof Backup"
echo "=============================="
echo ""

mkdir -p "$BACKUP_DIR"

echo "Creating backup: $BACKUP_NAME"
if [ -n "$COMPOSE_FILE_ARG" ]; then
  echo "Compose file: $COMPOSE_FILE_ARG"
fi
echo "Database: $DB_NAME"

echo "Backing up database..."
compose exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" > "$BACKUP_DIR/$BACKUP_NAME.sql"

echo "Backing up configuration..."
CONFIG_PATHS=()
for path in .env backend/.env mosquitto/config nginx/ssl; do
  if [ -e "$path" ]; then
    CONFIG_PATHS+=("$path")
  fi
done

if [ "${#CONFIG_PATHS[@]}" -gt 0 ]; then
  tar -czf "$BACKUP_DIR/$BACKUP_NAME-config.tar.gz" "${CONFIG_PATHS[@]}"
else
  echo "No local configuration files found to archive."
fi

echo ""
echo "Backup complete!"
echo ""
echo "Files:"
echo "  Database: $BACKUP_DIR/$BACKUP_NAME.sql"
if [ "${#CONFIG_PATHS[@]}" -gt 0 ]; then
  echo "  Config:   $BACKUP_DIR/$BACKUP_NAME-config.tar.gz"
fi
echo ""
echo "To restore:"
RESTORE_CMD="${COMPOSE_CMD[*]}"
if [ -n "$COMPOSE_FILE_ARG" ]; then
  RESTORE_CMD="$RESTORE_CMD -f $COMPOSE_FILE_ARG"
fi
echo "  cat $BACKUP_DIR/$BACKUP_NAME.sql | $RESTORE_CMD exec -T postgres psql -U $DB_USER $DB_NAME"
