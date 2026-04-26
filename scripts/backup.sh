#!/bin/bash

# ZeroProof - Backup Script
# Creates a backup of the database and configuration

set -e

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="zeroproof-backup-$TIMESTAMP"
DB_NAME="zeroproof"
COMPOSE_CMD="docker compose"

if ! docker compose version &> /dev/null; then
  if command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
  else
    echo "Docker Compose not found. Please install Docker Desktop or docker-compose."
    exit 1
  fi
fi

# Load env if present
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

# Prefer POSTGRES_DB from env
if [ -n "${POSTGRES_DB:-}" ]; then
  DB_NAME="$POSTGRES_DB"
fi

echo "ZeroProof Backup"
echo "=============================="
echo ""

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "Creating backup: $BACKUP_NAME"

# Backup PostgreSQL database
echo "Backing up database..."
$COMPOSE_CMD exec -T postgres pg_dump -U postgres "$DB_NAME" > "$BACKUP_DIR/$BACKUP_NAME.sql"

# Backup configuration files
echo "Backing up configuration..."
tar -czf "$BACKUP_DIR/$BACKUP_NAME-config.tar.gz" \
    .env \
    mosquitto/config/ \
    nginx/ssl/ \
    2>/dev/null || true

echo ""
echo "Backup complete!"
echo ""
echo "Files:"
echo "  Database: $BACKUP_DIR/$BACKUP_NAME.sql"
echo "  Config:   $BACKUP_DIR/$BACKUP_NAME-config.tar.gz"
echo ""
echo "To restore:"
echo "  cat $BACKUP_DIR/$BACKUP_NAME.sql | $COMPOSE_CMD exec -T postgres psql -U postgres $DB_NAME"
