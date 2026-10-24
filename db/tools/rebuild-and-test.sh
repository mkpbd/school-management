#!/usr/bin/env bash
# DEV/CI ONLY: drop + recreate the database, run bootstrap, migrations, seeds and invariant tests.
#   PGHOST=localhost PGPORT=5432 PGSUPERUSER=postgres DB=school_platform_dev db/tools/rebuild-and-test.sh
# Requires psql on PATH and that sms_owner / sms_app can log in (trust auth or PGPASSWORD / ~/.pgpass).
set -euo pipefail
export PGCLIENTENCODING=UTF8   # seeds/comments contain Bangla text

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${DB:-school_platform_dev}"
SU="${PGSUPERUSER:-postgres}"

if [[ "$DB" == "school_platform" && "${ALLOW_PROD_NAME:-}" != "yes" ]]; then
  echo "Refusing to drop '$DB' (set DB to a dev database name)." >&2; exit 1
fi

psql -X -q -U "$SU" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)"
psql -X -q -U "$SU" -d postgres -v db="$DB" -f "$ROOT/migrations/0000_bootstrap.sql"
PGUSER=sms_owner PGDATABASE="$DB" bash "$ROOT/tools/migrate.sh"
for f in "$ROOT"/seeds/*.sql; do
  echo "seeding $(basename "$f")"
  psql -X -q -U sms_owner -d "$DB" -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
psql -X -U sms_app -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/tests/invariants.sql" 2>&1 | sed 's/^psql:[^ ]* //'
