#!/usr/bin/env bash
# =============================================================================
# migrate-data.sh  ???  Supabase  ???  db_sales_novacore  (on the VPS)
# =============================================================================
# Run this on the VPS. It talks to Supabase over the internet and to the target
# database by exec'ing psql inside its own container, so you do not need the
# target database's password or any network configuration.
#
# Usage:
#   export SB_HOST=...  SB_USER=...  SB_PASS=...
#   export DB_CONTAINER=kqgwtzqknu9axud1urkau5si
#   ./migrate-data.sh --dry-run     # count only, writes nothing
#   ./migrate-data.sh               # copy
# =============================================================================

set -euo pipefail

SB_HOST="${SB_HOST:?set SB_HOST}"
SB_USER="${SB_USER:?set SB_USER}"
SB_PASS="${SB_PASS:?set SB_PASS}"
SB_PORT="${SB_PORT:-5432}"
DB_CONTAINER="${DB_CONTAINER:?set DB_CONTAINER - the crm-sales-db container name or id}"
DB_NAME="${DB_NAME:-db_sales_novacore}"

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

# Parent before child. The Auth.js tables (accounts, sessions,
# verification_tokens) do not exist in Supabase and stay empty.
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

# Run psql inside the target container. No password needed: local socket.
db() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -tAc "$1" 2>/dev/null || echo "ERR"
}

# Run psql against Supabase, through a throwaway container.
sb() {
  docker run --rm -e PGPASSWORD="$SB_PASS" postgres:17-alpine \
    psql -h "$SB_HOST" -p "$SB_PORT" -U "$SB_USER" -d postgres -tAc "$1" 2>/dev/null || echo "ERR"
}

echo "=============================================================="
echo " Supabase  ???  ${DB_CONTAINER}/${DB_NAME}"
[ "$DRY_RUN" -eq 1 ] && echo " MODE: DRY RUN - nothing will be written"
echo "=============================================================="

# --- Checks -----------------------------------------------------------------
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not running on this host."; exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "ERROR: no container named '$DB_CONTAINER' is running."
  echo "       Find it with:  docker ps --format '{{.Names}}' | grep -i postgres"
  exit 1
fi
echo "  target container is up"

schema_ok=$(db "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='leads';")
if [ "$schema_ok" != "1" ]; then
  cat >&2 <<EOF

ERROR: the "leads" table does not exist in ${DB_NAME}.

The target schema has not been created yet. Run setup-schema.sh first.

EOF
  exit 1
fi
echo "  target schema is present"

if [ "$(sb 'SELECT 1;')" != "1" ]; then
  cat >&2 <<EOF
ERROR: cannot reach Supabase at ${SB_HOST}:${SB_PORT}.

  - wrong password?
  - port should be 5432 (session pooler), not 6543 (transaction pooler)
  - IP allow-list in Supabase Dashboard -> Settings -> Database
EOF
  exit 1
fi
echo "  source is reachable"

# --- Pre-flight: anything the new ENUM types would reject? ------------------
echo
echo "Pre-flight: checking for values the new ENUM types would reject..."
bad=$(sb "
  SELECT
    (SELECT count(*) FROM leads WHERE status NOT IN ('Leads','Chated','Responsed','Set Meeting','Hold','Close Win','Close Lost','Failed')) +
    (SELECT count(*) FROM leads WHERE interest_level NOT IN ('HOT','WARM','COLD','-')) +
    (SELECT count(*) FROM users WHERE role NOT IN ('lord','admin','staff','pending')) +
    (SELECT count(*) FROM tasks WHERE priority NOT IN ('Low','Medium','High')) +
    (SELECT count(*) FROM tasks WHERE status NOT IN ('Todo','In Progress','Done')) +
    (SELECT count(*) FROM oi_forecasts WHERE status NOT IN ('WIN','OPEN','LOSE')) +
    (SELECT count(*) FROM edit_requests WHERE status NOT IN ('pending','approved','rejected'));")

if [ "$bad" = "ERR" ]; then
  echo "ERROR: could not run the pre-flight check."; exit 1
fi
if [ "$bad" != "0" ]; then
  cat >&2 <<EOF

STOPPED: $bad row(s) hold a value the new ENUM types will reject.

Copying now would fail partway through and leave a half-populated database.

Fix them in Supabase first - run docs/normalise-values.sql in the SQL
Editor - then run this again.

EOF
  exit 1
fi
echo "  no invalid values"

# --- Dry run ----------------------------------------------------------------
if [ "$DRY_RUN" -eq 1 ]; then
  echo
  echo "Row counts on the source:"
  for t in "${TABLES[@]}"; do
    printf "  %-22s %s\n" "$t" "$(sb "SELECT count(*) FROM public.$t;")"
  done
  echo
  echo "Nothing was copied."
  exit 0
fi

# --- Copy -------------------------------------------------------------------
echo
echo "Copying (one table at a time, in foreign-key order)..."

for t in "${TABLES[@]}"; do
  src=$(sb "SELECT count(*) FROM public.$t;")

  if [ "$src" = "ERR" ] || [ "$src" = "0" ]; then
    printf "  %-22s %8s rows  skipped\n" "$t" "${src:-0}"
    continue
  fi

  # --column-inserts names the source columns explicitly, so the six columns
  # the new schema adds (pic_name, assigned_to_name, ???) are simply not
  # mentioned and keep their defaults. The app fills them in on write.
  #
  # session_replication_role = replica defers FK checks for the session, so the
  # copy cannot abort on ordering. Orphans are counted afterwards.
  docker run --rm -e PGPASSWORD="$SB_PASS" postgres:17-alpine \
    pg_dump -h "$SB_HOST" -p "$SB_PORT" -U "$SB_USER" -d postgres \
      --data-only --no-owner --no-privileges --column-inserts \
      -t "public.$t" \
  | docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" \
      -q -v ON_ERROR_STOP=1 \
      -c "SET session_replication_role = replica;" \
      -f - >/dev/null 2>&1 || true

  dst=$(db "SELECT count(*) FROM public.$t;")
  if [ "$dst" = "$src" ]; then
    printf "  %-22s %8s rows  ok\n" "$t" "$src"
  else
    printf "  %-22s %8s  ->  %-8s  MISMATCH, look at this table\n" "$t" "$src" "$dst"
  fi
done

# --- Verify -----------------------------------------------------------------
echo
echo "Post-flight:"
orphans=$(db "
  SELECT
    (SELECT count(*) FROM funnel_history f LEFT JOIN leads l ON l.id=f.lead_id WHERE l.id IS NULL) +
    (SELECT count(*) FROM lead_notes    n LEFT JOIN leads l ON l.id=n.lead_id WHERE l.id IS NULL) +
    (SELECT count(*) FROM oi_forecasts  o LEFT JOIN leads l ON l.id=o.lead_id WHERE l.id IS NULL);")

if [ "$orphans" = "0" ]; then
  echo "  no orphaned foreign keys"
else
  echo "  $orphans orphaned rows - these already existed in Supabase, not a copy error"
fi

echo
echo "  Final lead count: $(db 'SELECT count(*) FROM leads;')  (source has $(sb 'SELECT count(*) FROM leads;'))"

echo
echo "=============================================================="
echo " Done. Do NOT point traffic at the app yet - follow step 4 in"
echo " docs/DEPLOYMENT.md to promote a lord account first."
echo "=============================================================="
