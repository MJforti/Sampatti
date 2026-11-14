#!/usr/bin/env bash
# Applies all migrations to a throwaway local Postgres 16 and runs tests/db/*.test.sql.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DATA="$(mktemp -d)"; PORT="${PGPORT_TEST:-54329}"
cleanup() { "$PGBIN/pg_ctl" -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT
if [ "$(id -u)" = 0 ]; then chown -R postgres "$DATA"; RUN="runuser -u postgres --"; else RUN=""; fi
$RUN "$PGBIN/initdb" -D "$DATA" -U postgres >/dev/null
$RUN "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp" -l "$DATA/log" start >/dev/null
PSQL="psql -h /tmp -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "create database t" >/dev/null
$PSQL -d t -f "$ROOT/tests/db/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do echo "migrate $(basename "$f")"; $PSQL -d t -f "$f" >/dev/null; done
for f in "$ROOT"/tests/db/*.test.sql; do echo "test $(basename "$f")"; $PSQL -d t -o /dev/null -f "$f" 2>&1 | sed -n "s/.*NOTICE:  //p"; test "${PIPESTATUS[0]}" = 0; done
echo "ALL DB TESTS PASSED"
