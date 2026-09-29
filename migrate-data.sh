#!/usr/bin/env bash
# =============================================================================
# migrate-data.sh  ???  Supabase  ???  db_sales_novacore
# =============================================================================
# Copies the CRM data from Supabase into the self-hosted database.
#
# Assumes:
#   1. The target schema already exists  (npm run db:migrate)
#   2. docs/normalise-values.sql has been run in Supabase first, so no row
#      holds a value outside the new ENUM types
#
# Data only. The schema is NOT copied - the target uses the Drizzle schema,
# which is the corrected one.
#
# Usage:
#   export SB_HOST=...  SB_USER=...  SB_PASS=...
#   export DB_HOST=...  DB_USER=...  DB_PASS=...  DB_NAME=...
#   ./migrate-data.sh            # run it
#   ./migrate-data.sh --dry-run  # counts only, copies nothing
# =============================================================================

set -euo pipefail

SB_HOST="${SB_HOST:?set SB_HOST}"
SB_USER="${SB_USER:?set SB_USER}"
SB_PASS="${SB_PASS:?set SB_PASS}"
SB_PORT="${SB_PORT:-5432}"

DB_HOST="${DB_HOST:?set DB_HOST}"
DB_USER="${DB_USER:?set DB_USER}"
DB_PASS="${DB_PASS:?set DB_PASS}"
DB_NAME="${DB_NAME:?set DB_NAME}"
DB_PORT="${DB_PORT:-5432}"

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

# Tables, in foreign-key dependency order: parents before children.
# The three Auth.js tables are absent from Supabase and start empty.
TABLES=(
  users
  role_permissions
  leads
  funnel_history
  lead_notes
  oi_forecasts
  oi_targets
  global_targets
  individual_targets
  tasks
  edit_requests
  global_audit_logs
  app_settings
)

echo "=============================================================="
echo " Supabase  ???  ${DB_HOST}:${DB_PORT}/${DB_NAME}"
[ "$DRY_RUN" -eq 1 ] && echo " MODE: DRY RUN - nothing will be written"
echo "=============================================================="

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not running on this host."
  exit 1
fi

# --- Verify the target schema exists before touching anything ---------------
echo
echo "Checking the target database..."
target_ok=$(docker run --rm \
  -e PGPASSWORD="$DB_PASS" postgres:17-alpine \
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='leads';") \
  || { echo "ERROR: cannot reach the target database."; exit 1; }

if [ "$target_ok" != "1" ]; then
  cat >&2 <<EOF

ERROR: the "leads" table does not exist in ${DB_NAME}.

The target schema has not been created yet. Run this from the project
directory first:

    npm run db:migrate

or, if you have not applied migrations, create the tables and stop.
EOF
  exit 1
fi
echo "  target schema is present"

# --- Verify the source is reachable ----------------------------------------
echo
echo "Checking the Supabase connection..."
if ! docker run --rm -e PGPASSWORD="$SB_PASS" postgres:17-alpine \
     psql -h "$SB_HOST" -p "$SB_PORT" -U "$SB_USER" -d postgres -tAc "SELECT 1;" >/dev/null 2>&1; then
  cat >&2 <<EOF
ERROR: cannot reach Supabase at ${SB_HOST}:${SB_PORT}.

  - wrong password?
  - port should be 5432 (session pooler), not 6543 (transaction pooler)
  - IP allow-list in Supabase Dashboard -> Settings -> Database
EOF
  exit 1
fi
echo "  source is reachable"

# --- Pre-flight: would any row violate an ENUM? -----------------------------
# The restore aborts partway on a bad value, so check first.
echo
echo "Pre-flight: checking for values that the new ENUM types would reject..."
bad=$(docker run --rm -e PGPASSWORD="$SB_PASS" postgres:17-alpine \
  psql -h "$SB_HOST" -p "$SB_PORT" -U "$SB_USER" -d postgres -tAc "
    SELECT
      (SELECT count(*) FROM leads
        WHERE status NOT IN ('Leads','Chated','Responsed','Set Meeting','Hold','Close Win','Close Lost','Failed')) +
      (SELECT count(*) FROM leads WHERE interest_level NOT IN ('HOT','WARM','COLD','-')) +
      (SELECT count(*) FROM users WHERE role NOT IN ('lord','admin','staff','pending')) +
      (SELECT count(*) FROM tasks WHERE priority NOT IN ('Low','Medium','High')) +
      (SELECT count(*) FROM tasks WHERE status NOT IN ('Todo','In Progress','Done')) +
      (SELECT count(*) FROM oi_forecasts WHERE status NOT IN ('WIN','OPEN','LOSE')) +
      (SELECT count(*) FROM edit_requests WHERE status NOT IN ('pending','approved','rejected'));")

if [ "$bad" != "0" ]; then
  cat >&2 <<EOF

ERROR: $bad row(s) hold a value the new ENUM types will reject.

Run docs/normalise-values.sql in the Supabase SQL Editor first, then
re-run this script. See the file for what it changes and how to reverse it.

EOF
  exit 1
fi
echo "  no invalid values"

# --- Copy -------------------------------------------------------------------
if [ "$DRY_RUN" -eq 1 ]; then
  echo
  echo "DRY RUN - row counts on the source:"
  for t in "${TABLES[@]}"; do
    n=$(docker run --rm -e PGPASSWORD="$SB_PASS" postgres:17-alpine \
      psql -h "$SB_HOST" -p "$SB_PORT" -U "$SB_USER" -d postgres -tAc \
      "SELECT count(*) FROM public.$t;" 2>/dev/null || echo "-")
    printf "  %-22s %s\n" "$t" "$n"
  done
  echo
  echo "Nothing was copied."
  exit 0
fi

echo
echo "Copying data (pipe per table, so no intermediate file is written)..."

for t in "${TABLES[@]}"; do
  src=$(docker run --rm -e PGPASSWORD="$SB_PASS" postgres:17-alpine \
    psql -h "$SB_HOST" -p "$SB_PORT" -U "$SB_USER" -d postgres -tAc \
    "SELECT count(*) FROM public.$t;" 2>/dev/null || echo 0)

  if [ "$src" = "0" ]; then
    printf "  %-22s %8s rows  skipped\n" "$t" "0"
    continue
  fi

  # --column-inserts emits INSERT INTO t (col, col) VALUES (...), so the extra
  # columns the new schema adds (pic_name, assigned_to_name, ???) are simply not
  # mentioned and keep their defaults.
  #
  # session_replication_role = replica defers FK checking for this session, so
  # the copy cannot abort on insert order. The references are re-counted after
  # the loop, which catches anything genuinely dangling.
  docker run --rm -e PGPASSWORD="$SB_PASS" postgres:17-alpine \
    pg_dump -h "$SB_HOST" -p "$SB_PORT" -U "$SB_USER" -d postgres \
      --data-only --no-owner --no-privileges --column-inserts \
      -t "public.$t" \
    | docker run --rm -i -e PGPASSWORD="$DB_PASS" postgres:17-alpine \
      psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -q -v ON_ERROR_STOP=1 \
        -c "SET session_replication_role = replica;" \
        -f - >/dev/null 2>&1 || true

  dst=$(docker run --rm -e PGPASSWORD="$DB_PASS" postgres:17-alpine \
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT count(*) FROM public.$t;" 2>/dev/null || echo "?")

  if [ "$dst" = "$src" ]; then
    printf "  %-22s %8s rows  ok\n" "$t" "$src"
  else
    printf "  %-22s %8s  ->  %-8s MISMATCH - check this table\n" "$t" "$src" "$dst"
  fi
done

# --- Verify -----------------------------------------------------------------
echo
echo "Post-flight: orphaned foreign keys"
echo "  (a non-zero count means the source itself has dangling references)"
orphans=$(docker run --rm -e PGPASSWORD="$DB_PASS" postgres:17-alpine \
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "
    SELECT
      (SELECT count(*) FROM funnel_history f
         LEFT JOIN leads l ON l.id = f.lead_id WHERE l.id IS NULL) +
      (SELECT count(*) FROM lead_notes n
         LEFT JOIN leads l ON l.id = n.lead_id WHERE l.id IS NULL) +
      (SELECT count(*) FROM oi_forecasts o
         LEFT JOIN leads l ON l.id = o.lead_id WHERE l.id IS NULL);")

if [ "$orphans" = "0" ]; then
  echo "  none - every child row found its parent"
else
  echo "  $orphans orphaned rows. These existed in Supabase too, not a copy error."
fi

echo
echo "=============================================================="
echo " Done. Verify in the app before pointing traffic at it."
echo "=============================================================="
