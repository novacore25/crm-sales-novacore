"""Diff a pasted Supabase column list against the expected Drizzle schema.

Usage:
    python diff-schema.py columns.txt

`columns.txt` should contain one "table.column" per line, which is what the
Supabase SQL Editor query returns. Extra whitespace and blank lines are ignored,
so pasting straight from the browser works.
"""
import re
import sys
from pathlib import Path


def group(items):
    out, cur, name = [], [], None
    for item in sorted(items):
        t, _, c = item.partition(".")
        if t != name:
            if name:
                out.append((name, cur))
            cur, name = [], t
        cur.append(c)
    if name:
        out.append((name, cur))
    return out


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: python diff-schema.py <pasted-columns.txt>")
        raise SystemExit(1)

    raw = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")

    live = set()
    for line in raw.splitlines():
        token = line.strip().strip('"').strip("'")
        # The SQL Editor prefixes each row with a row number: "1  leads.id"
        m = re.match(r"^(\d+)\s+(\w+)\.(\w+)$", token)
        if m:
            live.add(f"{m.group(2)}.{m.group(3)}")
        elif re.match(r"^\w+\.\w+$", token):
            live.add(token)

    expected = {
        l.strip()
        for l in Path("expected-columns.txt").read_text(encoding="utf-8").splitlines()
        if l.strip()
    }

    if not live:
        print("No 'table.column' lines found. Paste the SQL Editor result as-is.")
        raise SystemExit(1)

    missing = sorted(expected - live)
    extra = sorted(live - expected)

    live_tables = {c.split(".")[0] for c in live}
    exp_tables = {c.split(".")[0] for c in expected}
    auth = {"accounts", "sessions", "verification_tokens"}
    ghosts = sorted(live_tables - exp_tables - auth)

    print(f"Parsed {len(live)} columns across {len(live_tables)} tables from your paste.")
    print(f"Expected {len(expected)} columns across {len(exp_tables)} tables.\n")

    print("=" * 66)
    print("MISSING IN SUPABASE  (the app needs these, they are not there)")
    print("=" * 66)
    if missing:
        for t, cols in group(missing):
            print(f"  {t}: {', '.join(cols)}")
    else:
        print("  none - every expected column exists")

    print()
    print("=" * 66)
    print("EXTRA IN SUPABASE  (there, but not in the app schema)")
    print("=" * 66)
    if extra:
        for t, cols in group(extra):
            print(f"  {t}: {', '.join(cols)}")
    else:
        print("  none")

    if ghosts:
        print()
        print("=" * 66)
        print("TABLES ONLY IN SUPABASE  (the app does not model these at all)")
        print("=" * 66)
        for t in ghosts:
            print(f"  {t}")

    print()
    print("=" * 66)
    print("KNOWN DRIFT CHECK")
    print("=" * 66)
    for col in (
        "leads.pic_name",
        "leads.owner",
        "tasks.assigned_to_name",
        "tasks.assigned_by",
        "users.auth_id",
        "oi_forecasts.is_deleted",
    ):
        print(f"  {col:<30} {'present' if col in live else 'ABSENT'}")
    for t in ("settings", "app_settings", "role_permissions", "edit_requests"):
        print(f"  table {t:<25} {'present' if t in live_tables else 'ABSENT'}")


if __name__ == "__main__":
    main()
