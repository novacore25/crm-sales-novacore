# Migration: Supabase → self-hosted PostgreSQL

How to move the live dataset from Supabase into the new `crm-sales-db` resource
on the VPS, without corrupting anything.

> **Read this before running anything.** The steps are ordered, and step 2
> depends on step 1's output. Do not skip ahead.

## Current state

| | |
|---|---|
| **Source** | Supabase project (PostgreSQL + Auth) |
| **Target** | `crm-sales-db` resource on Coolify, database `db_sales_novacore` |
| **Method** | `pg_dump` → restore into the new schema → point the app at it |
| **Cutover** | Not yet scheduled. The old stack keeps running until you say so. |

The application code is already migrated. Only the **data** still needs to move.

## Before you start — rotate these credentials

The Supabase credentials are present in the old repository's commit history and
must be treated as compromised.

- [ ] **Rotate the Supabase database password.** It was hardcoded in
      `scripts/add_pic_name_column.cjs` and nine other committed scripts.
- [ ] **Regenerate the Supabase `service_role` key.** A committed JWT in
      `test_supa.cjs` decodes to `role: service_role`, which bypasses RLS
      entirely.
- [ ] **Revoke the GitHub PAT** that was shared in chat.
- [ ] **Rotate `AUTH_GOOGLE_SECRET`** if it was ever committed anywhere.

Do this **before** the migration, not after. The old database is still live and
serving traffic.

---

## Step 1 — Dump the live schema

> ⚠️ **Do not use the old `supabase/migrations/` folder as the source of truth.**
> It is out of sync with the production database. Discrepancies already found:
>
> - `leads.pic_name` and `leads.owner` exist in the live DB, created by
>   one-off scripts, but appear in no migration.
> - `tasks.assigned_to_name` and `tasks.assigned_by` likewise.
> - The UI queried a table named `settings`, which no migration ever created —
>   the code only worked because it silently fell back to a hardcoded array.
> - `00000000000002_recreate_schema_text.sql` **drops and recreates** every
>   table, so it is the real schema, not `00000000000000`.
> - `get_ghosted_leads` declared `lead_id UUID` and selected `leads.pic_name`,
>   neither of which match the TEXT-keyed schema.

The new Drizzle schema already encodes all of this, including the fixes. What
the dump gives you is **verification** — and any column the dump reveals that the
schema does not yet have.

Run from your machine (Docker required):

```powershell
.\dump-supabase.ps1
```

Or manually:

```powershell
docker run --rm `
  -e PGPASSWORD="<password>" `
  postgres:17-alpine `
  pg_dump -h <supabase-host> -p 5432 -U postgres.<ref> -d postgres `
    --schema-only --no-owner --no-privileges `
  > supabase-schema-live.sql
```

Then send me `supabase-schema-live.sql` and I will diff it against
`src/db/schema.ts` before anything touches the target database.

## Step 2 — Apply the new schema

Once the schema diff is clean:

```bash
# On the VPS, inside the crm-sales-db container terminal (Coolify)
# or locally against a throwaway database:
npm run db:migrate
```

This creates 16 tables: 13 domain, 3 for Auth.js.

## Step 3 — Copy the data

Only after step 2 is verified. Load in dependency order so foreign keys resolve:

```bash
# Order matters: parents before children.
#   users -> leads -> {funnel_history, lead_notes, oi_forecasts, tasks, edit_requests}
#          -> {global_targets, individual_targets, oi_targets, global_audit_logs, app_settings}
```

Two approaches:

**A. Full `pg_dump` restore (recommended).** Dump only the CRM tables from
Supabase and restore them into the new database, then apply column-level fixes:

```bash
pg_dump -h <supabase-host> -U postgres.<ref> -d postgres \
  -t users -t leads -t funnel_history -t lead_notes -t tasks \
  -t edit_requests -t oi_forecasts -t global_targets \
  -t individual_targets -t oi_targets -t global_audit_logs \
  -t app_settings -t role_permissions \
  --data-only --no-owner --column-inserts \
  > crm-data.sql
```

`--column-inserts` generates `INSERT INTO x (col, col) VALUES (...)` so extra
columns present in the source do not break the load.

**B. Row-by-row copy** via a script, if you need to transform values on the way
(e.g. `Basemen` → `MCN`, which an earlier migration already did in place).

After loading, verify counts per table. They should match the source exactly.

## Step 4 — Known data fixes

Apply only where the dump shows they are needed:

| Fix | Reason |
|---|---|
| `users.auth_id` may be `NULL` | Auth.js no longer uses it. Harmless; can be cleared. |
| `funnel_history.by_user_id` may dangle | Points at the old identity. `ON DELETE SET NULL` tolerates it. |
| `leads.pic_name` may be `NULL` | The UI falls back to the most recent funnel actor. |
| Product `Basemen` → `MCN` | Already applied by migration `20260916000000_rename_basemen_to_mcn.sql` on Supabase. Verify, do not re-apply blindly. |
| `edit_requests.requested_by_name` may be `NULL` | Nullable; the approvals list falls back to the id. |

## Step 5 — Seed the first admin

`role` defaults to `pending`, and only a `lord` can promote users — so the very
first account has to be promoted directly in SQL:

```sql
UPDATE users
SET role = 'lord'
WHERE email = 'your-email@example.com';
```

Do this before the first login, or nobody can approve anyone.

## Step 6 — Point the app at the new database

In Coolify, on the application resource, set:

```
DATABASE_URL=postgresql://postgres:<password>@kqgwtzqknu9axud1urkau5si:5432/db_sales_novacore
AUTH_SECRET=<openssl rand -base64 32>
AUTH_TRUST_HOST=true
AUTH_URL=https://crm.your-domain.com
AUTH_GOOGLE_ID=<client id>
AUTH_GOOGLE_SECRET=<client secret>
```

Then redeploy. Sign in with the `lord` account and walk the checklist below.

Add the production callback to the Google OAuth client:
`https://<your-domain>/api/auth/callback/google`.

---

## Verification checklist

Do not cut over until all of these pass against the new stack.

**Auth**
- [ ] Google sign-in redirects back to the CRM
- [ ] A new Google account lands on `/pending`, sees no CRM data
- [ ] `lord` can promote it from `/admin/users`
- [ ] The promoted user immediately gains access (database session, not JWT)
- [ ] Sign-out clears the session on the next request

**Data integrity**
- [ ] Lead count matches the source
- [ ] `funnel_history` count matches
- [ ] Spot-check 10 leads: stage, PIC, deal value, notes, history
- [ ] Repeat-order leads show both campaigns

**Features that were broken before this migration**

These are the ones worth testing deliberately, because they were non-functional
and are now expected to work:

- [ ] **Bulk update status** — previously wrote camelCase column names that do
      not exist, so nothing was saved and no funnel history was written
- [ ] **Bulk move to trash / restore** — previously wrote `isDeleted`,
      `deletedAt`, `autoDeleteAt` instead of the real columns
- [ ] **Import CSV** — previously wrote five non-existent columns and an
      invalid `interest_level` enum value
- [ ] **Approvals queue** (`/admin/approvals`) — previously ordered by a
      non-existent `timestamp` column and returned a 500
- [ ] **Edit funnel history** ("Edit Siluman") — previously wrote to `date` and
      `by` instead of `date_occurred` and `by_user_name`
- [ ] **Per-staff targets** (`/admin/targets`) — previously wrote to
      `oi_targets` with six wrong columns; should now persist in
      `individual_targets`
- [ ] **Task lead picker** — previously queried `leads.name`, which is not a
      column, so the dropdown was always empty
- [ ] **Campaign Ke-2** in the OI grid — previously wrote a column missing from
      the field map
- [ ] **Custom categories** — previously queried a table that did not exist, so
      it always fell back to the hardcoded list

**Regression**

- [ ] Dashboard totals match a manual count
- [ ] `/leads` loads fast and pagination is stable across pages
- [ ] Lead detail renders history, notes and tasks
- [ ] OI forecast grid saves and reflects values
- [ ] `lord` role permissions screen renders

---

## Rollback

Until the Supabase project is decommissioned, rollback is trivial: the old
Vercel deployment still points at Supabase and the data is untouched. Nothing in
this migration writes back to Supabase.

Keep the Supabase project alive for at least one full business cycle after
cutover. Deleting it is irreversible and should be a separate, deliberate
decision.

## After cutover

- [ ] Revoke/delete the Supabase project
- [ ] Delete the old Vercel deployment
- [ ] Configure automated backups for `crm-sales-db` in Coolify
- [ ] Point the database resource at a nightly backup schedule
- [ ] Confirm the backup actually restores
