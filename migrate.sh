#!/usr/bin/env bash
# =============================================================================
# migrate.sh  --  Supabase  ->  sales_novacore, on the VPS
# =============================================================================
# ONE script, ONE run. It does everything, in this order:
#
#   1. creates the schema in the target database (fetched from GitHub)
#   2. relaxes the ENUM columns to plain text
#   3. copies every table from Supabase
#   4. fixes the two known bad values - in the TARGET, not in Supabase
#   5. locks the columns back to ENUM, which validates the data
#   6. reports the row counts
#
# Supabase is only ever READ. Not one byte is written back to it.
#
# Usage:
#   export SB_HOST='aws-0-ap-southeast-1.pooler.supabase.com'
#   export SB_USER='postgres.xxxxxxxxxxxx'      # note the "postgres." prefix
#   export SB_PASS='...'
#   export DB_CONTAINER=kqgwtzqknu9axud1urkau5si
#
#   ./migrate.sh --dry-run    # steps 1 and 2 only, then prints the plan
#   ./migrate.sh              # the real thing
# =============================================================================

# On Debian and Ubuntu, `sh` is dash, which has no arrays, no `pipefail` and no
# here-strings - all of which this script uses. Re-exec under bash so that both
# `./migrate.sh` and `sh migrate.sh` behave the same instead of failing with
# "set: Illegal option -o pipefail".
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

SB_HOST="${SB_HOST:?set SB_HOST}"
SB_USER="${SB_USER:?set SB_USER}"
SB_PASS="${SB_PASS:?set SB_PASS}"
SB_PORT="${SB_PORT:-5432}"
DB_CONTAINER="${DB_CONTAINER:?set DB_CONTAINER}"
DB_NAME="${DB_NAME:-sales_novacore}"
REPO="${REPO:-novacore25/crm-sales-novacore}"
BRANCH="${BRANCH:-main}"

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

say()  { printf "\n\033[1;36m%s\033[0m\n" "$*"; }
ok()   { printf "  \033[0;32mok\033[0m    %s\n" "$*"; }
bad()  { printf "  \033[0;31mSTOP\033[0m  %s\n" "$*"; }
info() { printf "        %s\n" "$*"; }

# psql inside the target container. Local socket, so no password needed.
# stderr is captured rather than discarded, so a failure can be explained
# instead of surfacing as a bare "ERR" - which is what happened when the
# database name turned out to be wrong.
DB_ERR="$WORK/db.err"
db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -tAc "$1" 2>"$DB_ERR" || echo "ERR"; }
# psql against Supabase, read-only.
sb() { docker run --rm -e PGPASSWORD="$SB_PASS" postgres:17-alpine \
        psql -h "$SB_HOST" -p "$SB_PORT" -U "$SB_USER" -d postgres -tAc "$1" 2>/dev/null || echo "ERR"; }

TABLES=( users role_permissions leads funnel_history lead_notes oi_forecasts
         oi_targets global_targets individual_targets tasks edit_requests
         global_audit_logs app_settings )

# Every ENUM column, as "table:column:type". Relaxed before the copy so that a
# stray value cannot abort the restore, and locked back afterwards.
ENUM_COLUMNS=(
  "users:role:user_role"
  "leads:status:lead_status"
  "leads:interest_level:interest_level"
  "tasks:priority:task_priority"
  "tasks:status:task_status"
  "oi_forecasts:status:forecast_status"
  "edit_requests:status:edit_request_status"
  "role_permissions:role:user_role"
)

printf "\n\033[1m=============================================================="
printf "\\n Supabase  ->  %s/%s\033[0m\n" "$DB_CONTAINER" "$DB_NAME"
[ "$DRY_RUN" -eq 1 ] && printf " MODE: DRY RUN - only the plan is shown"
printf "==============================================================\n\033[0m"

# =============================================================================
say "Step 0  Checking things are reachable"
# =============================================================================
docker info >/dev/null 2>&1 || { bad "Docker is not running on this host."; exit 1; }
ok "docker is up"

docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER" \
  || { bad "no running container named '$DB_CONTAINER'"; info "find it:  docker ps --format '{{.Names}}' | grep -i postgres"; exit 1; }
ok "target container found"

info "host  : $SB_HOST:$SB_PORT"
info "user  : $SB_USER"
# Try once, capture the real error, then decide. The bare `[ "$(sb ...)" ]` form
# swallowed psql's message, so a wrong password and a wrong port looked
# identical and unexplained.
sb_err="$WORK/sb.err"
if ! docker run --rm -e PGPASSWORD="$SB_PASS" postgres:17-alpine \
     psql -h "$SB_HOST" -p "$SB_PORT" -U "$SB_USER" -d postgres -tAc "SELECT 1;" \
     >/dev/null 2>"$sb_err"; then
  bad "cannot reach Supabase at ${SB_HOST}:${SB_PORT}"
  info "psql said:"
  sed 's/^/        /' "$sb_err" | head -5
  echo
  info "most likely:"
  info "  - SB_USER is missing the 'postgres.' prefix."
  info "    It must be:  postgres.$(printf '%s' "$SB_USER" | sed 's/^postgres\.//')"
  info "  - port should be 5432 (session pooler), not 6543 (transaction pooler)"
  info "  - SB_PASS wrong, or the password has been rotated since you copied it"
  exit 1
fi
ok "supabase is reachable (read-only from here on)"

existing=$(db "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
if [ "$existing" = "ERR" ]; then
  bad "cannot query ${DB_NAME} inside the container"
  info "psql said:"
  sed 's/^/        /' "$DB_ERR" | head -4
  echo
  info "databases that actually exist in this container:"
  docker exec -i "$DB_CONTAINER" psql -U postgres -tAc \
    "SELECT '        ' || datname FROM pg_database WHERE datistemplate = false ORDER BY 1;" 2>/dev/null \
    | sed 's/^        //' || info "  (could not list them either - is the container a Postgres at all?)"
  echo
  info "if the name above is different, re-run with:"
  info "  export DB_NAME='<the name shown above>'"
  exit 1
fi
[ "$existing" = "0" ] \
  || { bad "${DB_NAME} already has ${existing} table(s)."; info "this script is only for an empty database."; exit 1; }
ok "target database is empty"

if [ "$DRY_RUN" -eq 1 ]; then
  say "DRY RUN  What will be copied"
  for t in "${TABLES[@]}"; do
    printf "        %-22s %8s rows\n" "$t" "$(sb "SELECT count(*) FROM public.$t;")"
  done
  printf "\n  %s columns will be relaxed to text, then locked back to enum:\n" "${#ENUM_COLUMNS[@]}"
  for c in "${ENUM_COLUMNS[@]}"; do printf "        %s\n" "${c//:/ }"; done
  printf "\n  nothing was written. Re-run without --dry-run when ready.\n\n"
  exit 0
fi

# =============================================================================
say "Step 1  Creating the schema in the target"
# =============================================================================
curl -fsSL "https://raw.githubusercontent.com/${REPO}/${BRANCH}/drizzle/0000_init.sql" -o "$WORK/schema.sql" \
  || { bad "could not download the schema from GitHub."; exit 1; }
grep -q 'CREATE TYPE "public"."lead_status"' "$WORK/schema.sql" \
  || { bad "the downloaded SQL has no CREATE TYPE statements. Refusing to apply it."; exit 1; }
info "downloaded $(wc -c < "$WORK/schema.sql") bytes"

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -f - < "$WORK/schema.sql"
ok "16 tables created"

# =============================================================================
say "Step 2  Relaxing ENUM columns to text"
# =============================================================================
# The target is empty, so this is instant. The point is that a stray value
# like status='Input' cannot abort the copy - it lands as plain text and gets
# dealt with in step 4.
for c in "${ENUM_COLUMNS[@]}"; do
  IFS=: read -r t col typ <<< "$c"
  db "ALTER TABLE $t ALTER COLUMN $col TYPE text USING $col::text;" >/dev/null
done
ok "${#ENUM_COLUMNS[@]} columns relaxed"

# =============================================================================
say "Step 3  Copying data from Supabase"
# =============================================================================
# --column-inserts names the source columns explicitly, so the columns this
# project adds (pic_name, assigned_to_name, etc) are simply not mentioned and
# keep their defaults. The app fills them in on write.
for t in "${TABLES[@]}"; do
  src=$(sb "SELECT count(*) FROM public.$t;")
  if [ "$src" = "ERR" ] || [ "$src" = "0" ]; then
    printf "  %-22s %8s rows   skipped\n" "$t" "${src:-0}"
    continue
  fi

  # session_replication_role = replica defers FK checks for the session, so the
  # copy cannot abort on insert order. Orphans are counted at the end.
  docker run --rm -e PGPASSWORD="$SB_PASS" postgres:17-alpine \
    pg_dump -h "$SB_HOST" -p "$SB_PORT" -U "$SB_USER" -d postgres \
      --data-only --no-owner --no-privileges --column-inserts -t "public.$t" \
  | docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" \
      -q -v ON_ERROR_STOP=1 -c "SET session_replication_role = replica;" -f - \
      > "$WORK/$t.err" 2>&1 || true

  dst=$(db "SELECT count(*) FROM public.$t;")
  if [ "$dst" = "$src" ]; then
    printf "  %-22s %8s rows   \033[0;32mok\033[0m\n" "$t" "$src"
  else
    printf "  %-22s %8s  ->  %-8s  \033[0;31mMISMATCH\033[0m\n" "$t" "$src" "$dst"
    head -3 "$WORK/$t.err" | sed 's/^/        /'
  fi
done

# =============================================================================
say "Step 4  Fixing the values that are not valid enum members"
# =============================================================================
# This happens entirely in the target database. Supabase is untouched.
n=$(db "SELECT count(*) FROM leads WHERE status='Input';")
db "UPDATE leads SET status='Leads' WHERE status='Input';" >/dev/null
ok "status 'Input' -> 'Leads'   ($n rows)"

n=$(db "SELECT count(*) FROM leads WHERE interest_level='Low';")
db "UPDATE leads SET interest_level='-' WHERE interest_level='Low';" >/dev/null
ok "interest_level 'Low' -> '-'  ($n rows)"

# Anything else unexpected: report it rather than guess.
echo
leftovers=0
for c in "${ENUM_COLUMNS[@]}"; do
  IFS=: read -r t col typ <<< "$c"
  case "$t:$col" in
    leads:status)             valid="'Leads','Chated','Responsed','Set Meeting','Hold','Close Win','Close Lost','Failed'" ;;
    leads:interest_level)     valid="'HOT','WARM','COLD','-'" ;;
    users:role|role_permissions:role) valid="'lord','admin','staff','pending'" ;;
    tasks:priority)           valid="'Low','Medium','High'" ;;
    tasks:status)             valid="'Todo','In Progress','Done'" ;;
    oi_forecasts:status)      valid="'WIN','OPEN','LOSE'" ;;
    edit_requests:status)     valid="'pending','approved','rejected'" ;;
  esac
  out=$(db "SELECT coalesce(string_agg(DISTINCT v, ', '), '(none)') FROM (SELECT $col::text AS v FROM $t WHERE $col IS NOT NULL AND $col::text NOT IN ($valid)) s;")
  if [ "$out" != "(none)" ] && [ "$out" != "ERR" ] && [ -n "$out" ]; then
    bad "$t.$col holds: $out"
    leftovers=$((leftovers+1))
  fi
done
[ "$leftovers" -eq 0 ] && ok "no remaining invalid values"

# =============================================================================
say "Step 5  Locking the columns back to ENUM"
# =============================================================================
# This is the validation step. If any value is still outside the allowed set,
# Postgres refuses the conversion and names the offending value - rather than
# leaving the database in a state the app cannot use.
for c in "${ENUM_COLUMNS[@]}"; do
  IFS=: read -r t col typ <<< "$c"
  if ! db "ALTER TABLE $t ALTER COLUMN $col TYPE $typ USING $col::$typ;" >/dev/null; then
    bad "could not convert $t.$col back to $typ - see step 4 above"
    exit 1
  fi
done
ok "${#ENUM_COLUMNS[@]} columns locked back to ENUM"

# =============================================================================
say "Step 6  Verification"
# =============================================================================
echo
printf "  %-22s %10s %10s\n" "table" "source" "target"
for t in "${TABLES[@]}"; do
  printf "  %-22s %10s %10s\n" "$t" "$(sb "SELECT count(*) FROM public.$t;")" "$(db "SELECT count(*) FROM public.$t;")"
done

orph=$(db "
  SELECT
    (SELECT count(*) FROM funnel_history f LEFT JOIN leads l ON l.id=f.lead_id WHERE l.id IS NULL) +
    (SELECT count(*) FROM lead_notes    n LEFT JOIN leads l ON l.id=n.lead_id WHERE l.id IS NULL) +
    (SELECT count(*) FROM oi_forecasts  o LEFT JOIN leads l ON l.id=o.lead_id WHERE l.id IS NULL);")

echo
if [ "$orph" = "0" ]; then
  ok "no orphaned foreign keys"
else
  info "$orph orphaned rows - these already existed in Supabase, not a copy error"
fi

printf "\n\033[1m=============================================================="
printf "\n Done.\033[0m\n"
printf " Next, before you open the app:\n"
printf "   docker exec -it %s psql -U postgres -d %s \\\n" "$DB_CONTAINER" "$DB_NAME"
printf "     -c \"UPDATE users SET role='lord' WHERE email='<email-anda>';\"\n"
printf " Nobody can approve anyone until an account is a lord.\n"
printf "==============================================================\n\n"
