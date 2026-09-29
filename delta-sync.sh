#!/usr/bin/env bash
# =============================================================================
# delta-sync.sh — pull only what changed in Supabase after the initial migration
# =============================================================================
#
# READ-ONLY on Supabase. Every write goes to the VPS database.
#
# --- Why migrate.sh cannot be reused -----------------------------------------
# migrate.sh pipes `pg_dump --data-only` into psql. That is a raw INSERT stream:
# a second run raises duplicate-key on every existing row, which it reports as
# "MISMATCH" and moves past, and it cannot update a row at all.
#
# --- Why this file is written the way it is -----------------------------------
# The first version of this script exported with \copy ... HEADER and loaded with
# \copy ... HEADER, assuming the header row maps columns BY NAME. It does not.
# HEADER only skips the first line; the data is matched BY POSITION. Two tables
# have different column ORDER in Supabase than on the VPS, so an email landed in
# a uuid column and a timestamp landed in a boolean column:
#
#   ERROR: invalid input syntax for type uuid: "mudrikateta@gmail.com"
#   ERROR: invalid input syntax for type boolean: "2026-08-18 00:36:54.489+00"
#
# Two tables happened to share column order and silently merged correctly, which
# is worse: the failure was visible only where it happened to land on a strict
# type.
#
# The fix is to make the ordering explicit on BOTH sides. The export SELECTs
# columns by name, in the order the TARGET table declares them, and the load
# names that same list. A column added to Supabase after this script was written
# cannot shift anything, and a column that exists on the target but not in
# Supabase is reported instead of silently corrupting a row.
#
# --- Merge strategy ----------------------------------------------------------
# DELETE-then-INSERT on the primary key, in one transaction, so a re-run is a
# no-op rather than an error. If the staged count does not match what Supabase
# reported, the transaction aborts and the table is left untouched.
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
err()  { printf '  \033[0;31m%s\033[0m\n' "$*"; }

db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -tAc "$1"; }

sb() { docker run --rm -e PGPASSWORD="$SB_PASSWORD" postgres:17-alpine \
         psql -h "$SB_HOST" -p "$SB_PORT" -U "$SB_USER" -d postgres -tAc "$1"; }

# Target column list, in the target's own declared order, excluding columns the
# target generates itself.
target_columns() {
  db "SELECT string_agg(quote_ident(attname), ',' ORDER BY attnum)
        FROM pg_attribute
       WHERE attrelid = 'public.$1'::regclass
         AND attnum > 0 AND NOT attisdropped
         AND attname <> 'updated_at';"
}

primary_key() {
  db "SELECT a.attname FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = 'public.$1'::regclass AND i.indisprimary
       LIMIT 1;"
}

# Which of the target's columns does Supabase actually have? A column present
# only on the target must not be selected from the source, and one present only
# in the source is ignored - the preflight prints both so a schema drift is
# visible instead of silent.
source_columns() {
  sb "SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position)
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = '$1';"
}

export_rows() {  # t, column-list, ts-column
  docker run --rm -e PGPASSWORD="$SB_PASSWORD" postgres:17-alpine \
    psql -h "$SB_HOST" -p "$SB_PORT" -U "$SB_USER" -d postgres -q -c \
    "\copy (SELECT $2 FROM public.$1 WHERE $3 > '$CUTOFF') TO STDOUT WITH (FORMAT csv, HEADER true)"
}

# Parents before children: a referenced row must exist before something points
# at it. `users` and `leads` are listed even though the count is expected to be
# small, because a sign-up or lead created after the migration must not be lost.
TABLES=(
  "users:created_at"
  "leads:updated_at"
  "funnel_history:created_at"
  "lead_notes:created_at"
  "oi_forecasts:updated_at"
)

say "Cutoff: anything changed after $CUTOFF"

# ---------------------------------------------------------------------------
# Preflight. Schema drift is checked BEFORE anything is written, because the
# previous version of this script found out about a column-order mismatch by
# trying to insert an email into a uuid column.
# ---------------------------------------------------------------------------
say "Step 1  Column check (target order is authoritative)"
DRIFT=0
declare -A COLS=()
for spec in "${TABLES[@]}"; do
  t="${spec%%:*}"
  tgt="$(target_columns "$t")"
  src="$(source_columns "$t" || true)"

  # Keep only columns the target declares AND the source actually has, in the
  # TARGET's order. This is what makes the export and the load line up.
  keep="$(db "SELECT string_agg(t.c, ',' ORDER BY t.ord)
               FROM unnest(string_to_array('''$tgt''', ',')) WITH ORDINALITY AS t(c, ord)
               JOIN unnest(string_to_array(COALESCE('''$src''',''), ',')) AS s(c)
                 ON t.c = s.c;")"
  COLS["$t"]="$keep"

  n_tgt=$(printf '%s' "$tgt" | tr ',' '\n' | grep -c . || true)
  n_keep=$(printf '%s' "$keep" | tr ',' '\n' | grep -c . || true)
  if [ "$n_keep" = "$n_tgt" ]; then
    printf '  %-16s %2s columns, all present in Supabase\n' "$t" "$n_keep"
  else
    warn "$t - $n_keep of $n_tgt columns exist in Supabase. Missing: $(db "SELECT coalesce(string_agg(t.c, ', '), '(none)') FROM unnest(string_to_array('''$tgt''',',')) WITH ORDINALITY AS t(c,ord) LEFT JOIN unnest(string_to_array(COALESCE('''$src''',''),',')) AS s(c) ON t.c = s.c WHERE s.c IS NULL;")"
    DRIFT=1
  fi
done

if [ "$DRIFT" -eq 1 ]; then
  say "Schema drift detected - stopping before any write."
  echo "  The columns listed above exist on the VPS but not in Supabase."
  echo "  Re-run this once someone confirms the source is not mid-migration."
  exit 1
fi

# ---------------------------------------------------------------------------
# Count. This is the number worth checking before writing.
# ---------------------------------------------------------------------------
say "Step 2  What changed in Supabase"
declare -A EXPECTED=()
total_delta=0
for spec in "${TABLES[@]}"; do
  t="${spec%%:*}"; col="${spec##*:}"
  n=$(sb "SELECT count(*) FROM public.$t WHERE $col > '$CUTOFF';")
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
  echo "  Re-run with --apply once these numbers look right."
  exit 0
fi

if [ "$total_delta" -eq 0 ]; then
  say "Nothing changed. Nothing to do."
  exit 0
fi

# ---------------------------------------------------------------------------
# Merge, one table per transaction.
# ---------------------------------------------------------------------------
say "Step 3  Merging"
failed=0
for spec in "${TABLES[@]}"; do
  t="${spec%%:*}"; col="${spec##*:}"
  n="${EXPECTED[$t]}"
  [ "$n" = "0" ] && { ok "$t - skipped (no change)"; continue; }

  csv="$WORK/$t.csv"
  export_rows "$t" "${COLS[$t]}" "$col" > "$csv"

  if [ ! -s "$csv" ] || ! head -1 "$csv" | grep -q .; then
    err "$t - export produced no data. Target untouched."
    failed=1
    continue
  fi

  pk="$(primary_key "$t")"
  collist="${COLS[$t]}"
  sql="$WORK/$t.sql"
  cat > "$sql" <<SQL
BEGIN;
CREATE TEMP TABLE stg (LIKE public.$t INCLUDING ALL);
\copy stg ($collist) FROM STDIN WITH (FORMAT csv, HEADER true)
$(cat "$csv")
\.
DO \$\$
DECLARE
  staged   int;
  existing int;
BEGIN
  SELECT count(*) INTO staged FROM stg;
  IF staged <> $n THEN
    RAISE EXCEPTION 'ABORT: row count mismatch, target untouched';
  END IF;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = ANY(SELECT %I FROM stg)',
                 '$t', '$pk', '$pk') INTO existing;
  RAISE NOTICE 'RESULT new=%, updated=%', staged - existing, existing;
  EXECUTE format('DELETE FROM public.%I WHERE %I = ANY(SELECT %I FROM stg)',
                 '$t', '$pk', '$pk');
  EXECUTE 'INSERT INTO public.' || quote_ident('$t') || ' SELECT * FROM stg';
END
\$\$;
COMMIT;
SQL

  if out=$(docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" \
             -v ON_ERROR_STOP=1 -q -f - < "$sql" 2>&1); then
    res=$(printf '%s' "$out" | grep -o 'RESULT .*' | head -1 | sed 's/^RESULT //')
    ok "$t - ${res:-merged}"
  else
    err "$t - FAILED, target unchanged for this table."
    printf '        %s\n' "$(printf '%s' "$out" | grep -iE 'error|exception' | head -2 | tr '\n' ' ')"
    failed=1
  fi
done

# ---------------------------------------------------------------------------
# Verify.
# ---------------------------------------------------------------------------
say "Step 4  Row counts on the VPS"
for spec in "${TABLES[@]}"; do
  t="${spec%%:*}"
  printf '  %-16s %8s   (supabase: %s)\n' "$t" "$(db "SELECT count(*) FROM public.$t;")" "${EXPECTED[$t]} expected changed"
done

if [ "$failed" -eq 1 ]; then
  err "One or more tables failed. Their data is unchanged - re-run after fixing."
  exit 1
fi
say "Done."
