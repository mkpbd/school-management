#!/usr/bin/env bash
# Apply db/migrations/NNNN_*.sql in order, each in its own transaction, recording them in sys.schema_migration.
# Usage:  PGHOST=... PGPORT=... PGUSER=sms_owner PGDATABASE=school_platform db/tools/migrate.sh
# 0000_bootstrap.sql is NOT run here (needs a superuser; see db/README.md).
# Files named *_standardize.sql, *_grants.sql and 0090_comments.sql are "repeatable": re-applied when their checksum changes.
set -euo pipefail
export PGCLIENTENCODING=UTF8   # seeds/comments contain Bangla text

DIR="$(cd "$(dirname "$0")/../migrations" && pwd)"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -c "CREATE SCHEMA IF NOT EXISTS sys;
  CREATE TABLE IF NOT EXISTS sys.schema_migration (
    version    text PRIMARY KEY,
    checksum   text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now());" 2>/dev/null || true

for f in "$DIR"/[0-9][0-9][0-9][0-9]_*.sql; do
  name="$(basename "$f" .sql)"
  [[ "$name" == 0000_* ]] && continue
  sum="$(sha256sum "$f" | cut -c1-16)"
  applied="$("${PSQL[@]}" -tAc "SELECT checksum FROM sys.schema_migration WHERE version = '$name'")"
  repeatable=false
  [[ "$name" == *_standardize || "$name" == *_grants || "$name" == *_comments || "$name" == *_fk_indexes ]] && repeatable=true
  if [[ -n "$applied" ]]; then
    if [[ "$applied" == "$sum" ]]; then continue; fi
    if [[ "$repeatable" != true ]]; then
      echo "ERROR: $name was modified after being applied (checksum $applied -> $sum). Write a new migration." >&2
      exit 1
    fi
  fi
  echo "applying $name"
  "${PSQL[@]}" -1 -f "$f" \
    -c "INSERT INTO sys.schema_migration(version, checksum) VALUES ('$name', '$sum')
        ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now();"
done
echo "database is up to date"
