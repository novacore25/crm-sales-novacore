#!/bin/sh
# =============================================================================
# vps-schema-check.sh
# =============================================================================
# Dumps the live Supabase schema and compares it against the Drizzle schema this
# app expects. Prints ONLY the differences, so the output is short enough to
# paste into a chat.
#
# Run it on the VPS (any Linux shell). Requires Docker.
#
#   sh vps-schema-check.sh
#
# Credentials are read from environment variables so nothing is written to disk:
#
#   export SB_HOST='aws-0-ap-southeast-1.pooler.supabase.com'
#   export SB_USER='postgres.abcdefghijklm'
#   export SB_PASS='...'
#   sh vps-schema-check.sh
# =============================================================================

set -eu

: "${SB_HOST:?set SB_HOST}"
: "${SB_USER:?set SB_USER}"
: "${SB_PASS:?set SB_PASS}"
SB_PORT="${SB_PORT:-5432}"
WORK="${WORK:-/tmp/schema-check}"

mkdir -p "$WORK"
cp ./expected-columns.txt "$WORK/expected-columns.txt"

echo "1/2  dumping Supabase schema (${SB_USER}@${SB_HOST}:${SB_PORT})..."

docker run --rm \
  -e PGPASSWORD="$SB_PASS" \
  -v "$WORK:/out" \
  postgres:17-alpine \
  pg_dump -h "$SB_HOST" -p "$SB_PORT" -U "$SB_USER" -d postgres \
    --schema-only --no-owner --no-privileges \
    -f /out/live-schema.sql

if [ ! -s "$WORK/live-schema.sql" ]; then
  echo "ERROR: dump produced no output. Check the password, the port"
  echo "       (5432 = session pooler, NOT 6543), and any IP restriction."
  exit 1
fi

echo "     dump size: $(wc -c < "$WORK/live-schema.sql") bytes"
echo "2/2  comparing against the Drizzle schema..."

docker run --rm -v "$WORK:/work" python:3.12-alpine python - <<'PYEOF'
import re
from pathlib import Path

live = Path("/work/live-schema.sql").read_text(encoding="utf-8", errors="replace")
expected = {
    l.strip() for l in Path("/work/expected-columns.txt").read_text().splitlines() if l.strip()
}

# --- parse the live schema ---
# Tables may or may not be schema-qualified depending on how pg_dump emitted them.
live_cols = set()
live_tables = set()
for m in re.finditer(r'CREATE TABLE\s+(?:"?(\w+)"?\.)?"?(\w+)"?\s*\((.*?)\n\);', live, re.S):
    table, body = m.group(2), m.group(3)
    live_tables.add(table)
    for line in body.splitlines():
        c = re.match(r'\s*"(\w+)"\s', line) or re.match(r"\s*(\w+)\s+(?:text|int|numeric|boolean|date|timestamp|uuid|jsonb)", line)
        if c:
            live_cols.add(f"{table}.{c.group(1)}")

expected_tables = {c.split(".")[0] for c in expected}
app_tables = expected_tables - {"accounts", "sessions", "verification_tokens"}

missing = sorted(expected - live_cols)          # app needs it, Supabase lacks it
extra   = sorted(live_cols - expected)          # Supabase has it, schema lacks it
ghost   = sorted(live_tables - expected_tables)  # tables only in Supabase

def group(items):
    out, cur, name = {}, [], None
    for item in sorted(items):
        t, _, c = item.partition(".")
        if t != name:
            if name: out[name] = cur
            cur, name = [], t
        cur.append(c)
    if name: out[name] = cur
    return out

print()
print("=" * 68)
print("SUMMARY")
print("=" * 68)
print(f"  live tables found      : {len(live_tables)}")
print(f"  expected tables (app)  : {len(app_tables)}  (+3 Auth.js tables)")
print(f"  matching columns       : {len(expected & live_cols)} / {len(expected)}")

print()
print("=" * 68)
print("MISSING IN SUPABASE  (the app expects these, they are not there)")
print("=" * 68)
if missing:
    for t, cols in group(missing).items():
        print(f"  {t}: {', '.join(cols)}")
else:
    print("  none - schema is complete")

print()
print("=" * 68)
print("EXTRA IN SUPABASE  (present there, absent from the app schema)")
print("=" * 68)
if extra:
    for t, cols in group(extra).items():
        print(f"  {t}: {', '.join(cols)}")
else:
    print("  none")

if ghost:
    print()
    print("=" * 68)
    print("TABLES ONLY IN SUPABASE  (not modelled by the app at all)")
    print("=" * 68)
    for t in ghost:
        print(f"  {t}")

# Flag the specific drift the old migration folder was missing.
print()
print("=" * 68)
print("KNOWN DRIFT CHECK")
print("=" * 68)
for col in ("leads.pic_name", "leads.owner", "tasks.assigned_to_name",
            "tasks.assigned_by", "users.auth_id", "oi_forecasts.is_deleted"):
    state = "present" if col in live_cols else "ABSENT"
    print(f"  {col:<28} {state}")

for t in ("settings", "app_settings", "role_permissions", "edit_requests"):
    state = "present" if t in live_tables else "ABSENT"
    print(f"  table {t:<21} {state}")

fns = sorted(set(re.findall(r'CREATE (?:OR REPLACE )?FUNCTION\s+(?:"?\w+"?\.)"?(\w+)"?\s*\(', live)))
print()
print(f"  functions in Supabase : {', '.join(fns) if fns else 'none'}")

print()
print("Full dump saved at: %s/live-schema.sql" % "/tmp/schema-check")
print("Send the output above; the raw file is only needed if something looks wrong.")
print()
PYEOF

echo "Done."
