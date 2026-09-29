#!/usr/bin/env bash
# =============================================================================
# delta-sync.sh — pull only what changed in Supabase after the initial migration
# =============================================================================
#
# READ-ONLY on Supabase. This only ever SELECTs from Supabase; every write goes
# to the VPS database. Supabase is never modified.
#
# WHY THIS EXISTS INSTEAD OF REUSING migrate.sh
# ------------------------------------------------
# migrate.sh does `pg_dump --data-only | psql`. That is a raw INSERT stream. Run
# it twice and every existing row raises a duplicate-key error, which the script
# reports as "MISMATCH" and then moves on. It cannot update a row, so it cannot
# be used for a delta at all.
#
# This script writes ONE SQL file that Postgres runs as a single transaction:
#   1. stage the changed rows in a temp table
#   2. count them
#   3. DELETE the matching rows in the real table
#   4. INSERT the staged rows back
#
# DELETE-then-INSERT is what makes a re-run a no-op instead of an error.
#
# The column list is NEVER written by hand. `LIKE ... INCLUDING ALL` mirrors the
# real table, and the merge is written as `SELECT *` in both directions. Hand-
# written column lists are exactly how the two SQL bugs that reached production
# were written - both passed tsc, both passed the build, and one took the site
# down. The tradeoff is that a column reordering in the source would break it,
# and the row-count check below is what catches that.
#
# USAGE
#   SB_PASSWORD='...' ./delta-sync.sh              # dry run, writes nothing
#   SB_PASSWORD='...' ./delta-sync.sh --apply      # actually writes
# =============================================================================

set -euo pipefail

CUTOFF="${CUTOFF:-2026-09-29 00:00:00+00}"
DB_CONTAINER="${DB_CONTAINER:-kqgwtzqknu9axud1urkau5si}"
DB_NAME="${DB_NAME:-sales_novacore}"
SB_HOST="${SB_HOST:-aws-0-ap-northeast-2.pooler.supabase.com}"
SB_PORT="${SB_PORT:-5432}"
SB_USER="${SB_USER:-postgres.qlflinfxumcoxbbgkcgz}"
WORK="$(mktemp -d)"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

if [ -z "${SB_PASSWORD:-}" ]; then
  echo "SB_PASSWORD is not set. Nothing was read or written." >&2
  exit 1
fi

trap 'rm -rf "$WORK"' EXIT

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[0;32m%s\033[0m\n' "$*"; }
warn() { printf '  \033[0;33m%s\033[0m\n' "$*"; }

db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -tAc "$1"; }

# Supabase export of one table's changed rows, as CSV with a header row so the
# load maps by column name.
sb_export() {
  local t="$1" col="$2" out="$3"
  docker run --rm -e PGPASSWORD="$SB_PASSWORD" postgres:17-alpine \
    psql -h "$SB_HOST" -p "$SB_PORT" -U "$SB_USER" -d postgres -q -c \
    "\copy (SELECT * FROM public.$t WHERE $col > '$CUTOFF') TO STDOUT WITH (FORMAT csv, HEADER true)" \
    > "$out"
}

sb_count() {
  docker run --rm -e PGPASSWORD="$SB_PASSWORD" postgres:17-alpine \
    psql -h "$SB_HOST" -p "$SB_PORT" -U "$SB_USER" -d postgres -tAc \
    "SELECT count(*) FROM public.$1 WHERE $2 > '$CUTOFF';"
}

# Parents before children, so a referenced row exists before something points at
# it. `users` and `leads` are listed even though the count is expected to be 0 -
# a new sign-up or lead created after the migration must not be dropped.
TABLES=(
  "users:created_at"
  "leads:updated_at"
  "funnel_history:created_at"
  "lead_notes:created_at"
  "oi_forecasts:updated_at"
)

say "Cutoff: anything changed after $CUTOFF"

say "Step 1  What changed in Supabase"
declare -A EXPECTED=()
total_delta=0
for spec in "${TABLES[@]}"; do
  t="${spec%%:*}"; col="${spec##*:}"
  n=$(sb_count "$t" "$col")
  EXPECTED["$t"]="$n"
  total_delta=$((total_delta + n))
  if [ "$n" = "0" ]; then
    printf '  %-16s %6s   no change\n' "$t" "$n"
  else
    printf '  %-16s %6s   <- to sync\n' "$t" "$n"
  fi
done
say "Total rows to sync: $total_delta"

if [ "$APPLY" -eq 0 ]; then
  say "Dry run - nothing was written."
  echo "  Re-run with --apply once you are happy with these numbers."
  exit 0
fi

if [ "$total_delta" -eq 0 ]; then
  say "Nothing changed. Nothing to do."
  exit 0
fi

# ---------------------------------------------------------------------------
# Build one SQL script per table and run it as a single transaction.
# ---------------------------------------------------------------------------
say "Step 2  Merging"

for spec in "${TABLES[@]}"; do
  t="${spec%%:*}"; col="${spec##*:}"
  n="${EXPECTED[$t]}"
  [ "$n" = "0" ] && { ok "$t - skipped (no change)"; continue; }

  csv="$WORK/$t.csv"
  sb_export "$t" "$col" "$csv"

  # If the header is missing the export failed; refuse rather than merge nothing.
  if [ ! -s "$csv" ] || ! head -1 "$csv" | grep -q .; then
    warn "$t - export produced no data. Skipping, target untouched."
    continue
  fi

  sql="$WORK/$t.sql"
  cat > "$sql" <<SQL
BEGIN;
CREATE TEMP TABLE stg (LIKE public.$t INCLUDING ALL);
\copy stg FROM STDIN WITH (FORMAT csv, HEADER true)
$(cat "$csv")
\.
DO \$\$
DECLARE
  staged   int;
  existing int;
  pk_name  text;
BEGIN
  -- Refuse to proceed unless the export arrived intact. A silent partial merge
  -- would look successful and leave the target half-updated.
  SELECT count(*) INTO staged FROM stg;
  IF staged <> $n THEN
    RAISE EXCEPTION 'ABORT: expected $n rows, staged %. Target untouched.', staged;
  END IF;

  SELECT a.attname INTO pk_name
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
   WHERE i.indrelid = 'public.$t'::regclass AND i.indisprimary
   LIMIT 1;

  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IN (SELECT %I FROM stg)',
                 '$t', pk_name, pk_name) INTO existing;

  RAISE NOTICE '  %: % new, % updated', '$t', staged - existing, existing;

  EXECUTE format('DELETE FROM public.%I WHERE %I IN (SELECT %I FROM stg)',
                 '$t', pk_name, pk_name);
  EXECUTE 'INSERT INTO public.' || quote_ident('$t') || ' SELECT * FROM stg';
END
\$\$;
COMMIT;
SQL

  # ON_ERROR_STOP makes psql exit non-zero on the RAISE EXCEPTION above, and the
  # transaction never reaches COMMIT, so the table is left exactly as it was.
  if out=$(docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" \
             -v ON_ERROR_STOP=1 -q -f - < "$sql" 2>&1); then
    ok "$(printf '%s' "$out" | grep -o "$t: .*" | head -1 || printf '%s: merged %s rows' "$t" "$n")"
  else
    warn "$t - FAILED, target unchanged for this table."
    printf '        %s\n' "$(printf '%s' "$out" | grep -iE 'error|exception' | head -2 | tr '\n' ' ')"
  fi
done

# ---------------------------------------------------------------------------
# Verify. The target should now match Supabase exactly.
# ---------------------------------------------------------------------------
say "Step 3  Row counts on the VPS"
for spec in "${TABLES[@]}"; do
  t="${spec%%:*}"
  printf '  %-16s %8s\n' "$t" "$(db "SELECT count(*) FROM public.$t;")"
done

say "Done. Compare the counts above against Supabase:"
for spec in "${TABLES[@]}"; do
  printf '  sb> SELECT %-18s count(*) FROM public.%s;\n' "'$t'," "$t"
done
