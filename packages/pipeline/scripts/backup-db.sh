#!/usr/bin/env bash
# Dump the production database to a timestamped .sql file.
# Run this BEFORE applying the snapshot tables migration.
#
# Usage: ./scripts/backup-db.sh

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set" >&2
  exit 1
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/backups"
mkdir -p "$DIR"

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUT="$DIR/db-$STAMP.sql"

PG_DUMP="${PG_DUMP:-pg_dump}"
echo "Dumping database to $OUT (using $PG_DUMP) ..."
"$PG_DUMP" "$DATABASE_URL" --no-owner --no-privileges > "$OUT"

SIZE="$(wc -c < "$OUT")"
echo "Wrote $SIZE bytes"
echo "Restore with: psql \"\$DATABASE_URL\" < $OUT"
