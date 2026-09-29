# Deployment runbook — CRM Sales Novacore

Ordered steps from an empty database to a running app. Each step says what to
run, where, and how to tell it worked.

---

## Step 0 — Before anything: rotate the leaked credentials

The old repository committed a Supabase `service_role` key and the database
password. Both are still live.

- [ ] Rotate the Supabase database password
- [ ] Regenerate the Supabase `service_role` key
- [ ] Revoke the GitHub PAT shared in chat
- [ ] Rotate `AUTH_GOOGLE_SECRET` if it was ever committed

Do this first. The old database is still serving traffic.

---

## Step 1 — Normalise the dirty values in Supabase

Supabase SQL Editor, run statements one at a time.
File: [`docs/normalise-values.sql`](docs/normalise-values.sql)

| Step | What | Why |
|---|---|---|
| 1 | Backup query | Reversal data for the 55 affected rows |
| 2 | `status 'Input'` → `'Leads'` (53 rows) | `'Input'` is not a valid `lead_status`; it means the brand is in the database but not yet contacted, which is exactly what `'Leads'` means |
| 3 | `interest_level 'Low'` → `'-'` (2 rows) | `'Low'` is not a valid `interest_level`. It is the *task priority* vocabulary, written by an import script that used the wrong scale |
| 4 | Verification query | Both should return no rows |

**Do not run this yet if you are not ready to copy** — it changes the live
database. It only makes the old app *more* correct (`'Input'` was never in its
stage list), but it is still a write to production.

---

## Step 2 — Create the schema on the VPS

In the Coolify application resource, set these environment variables first:

```
DATABASE_URL=postgresql://postgres:<password>@crm-sales-db:5432/db_sales_novacore
AUTH_SECRET=<output of: openssl rand -base64 32>
AUTH_TRUST_HOST=true
AUTH_URL=https://<your-domain>
AUTH_GOOGLE_ID=<client id>
AUTH_GOOGLE_SECRET=<client secret>
```

Then apply the migration. Either:

**A. Locally**, pointing at the VPS database from your machine (needs the
database reachable — it is not, by design; see note below), or

**B. On the VPS**, in a shell:

```bash
cd /path/to/crm-sales-novacore
npm ci
npm run db:migrate
```

> The database is intentionally not exposed to the internet, so you cannot run
> `db:migrate` from your laptop against it. Either run it on the VPS, or
> temporarily open the database in Coolify, run the migration, and close it
> again.

Check it worked:

```bash
docker exec -it <crm-sales-db-container> psql -U postgres -d db_sales_novacore \
  -c "\dt"
```

Expect **16 tables**: 13 domain, plus `accounts`, `sessions`,
`verification_tokens`.

---

## Step 3 — Copy the data

Upload `migrate-data.sh` to the VPS, then:

```bash
export SB_HOST='aws-0-ap-southeast-1.pooler.supabase.com'
export SB_USER='postgres.xxxxxxxxxxxx'
export SB_PASS='<supabase password>'
export SB_PORT=5432

export DB_HOST='crm-sales-db'
export DB_USER='postgres'
export DB_PASS='<password from the crm-sales-db resource>'
export DB_NAME='db_sales_novacore'

./migrate-data.sh --dry-run     # counts only, copies nothing
./migrate-data.sh               # the real thing
```

The dry run is worth doing. It prints the row count per table without writing
anything.

The script refuses to run if the target schema is missing, if the source is
unreachable, or if any row holds a value the new ENUM types would reject. It
copies table by table in foreign-key order and compares counts as it goes,
flagging any mismatch.

Expect:

| Table | Rows |
|---|---|
| `leads` | 6399 |
| `funnel_history` | ? |
| `lead_notes` | ? |
| `users` | 23 |
| `oi_forecasts` | ? |
| `tasks` | 0 |
| `edit_requests` | ? |

`users` is 23 (9 staff, 2 lord, 10 pending, 2 admin). `tasks` is empty.

---

## Step 4 — Promote the first admin

`role` defaults to `pending`, and only a `lord` can approve anyone — so the
first account has to be promoted directly:

```bash
docker exec -it <crm-sales-db-container> psql -U postgres -d db_sales_novacore \
  -c "UPDATE users SET role='lord' WHERE email='<your email>';"
```

Do this **before** the first login, or nobody can approve anybody.

---

## Step 5 — Point the app at it and deploy

Coolify → the application resource → **Redeploy**.

Add the production callback to the Google OAuth client:
`https://<your-domain>/api/auth/callback/google`

---

## Step 6 — Verify

Work through the checklist in
[`docs/MIGRATION.md`](docs/MIGRATION.md).

The highest-value checks, because they cover features that were silently broken
before and are now expected to work:

- [ ] Dashboard **search** returns results — it returned an error before,
      because the filter named a `pic_name` column that does not exist
- [ ] A custom category added in the lead form persists across a reload
- [ ] Per-staff targets save and are still there after a reload
- [ ] The approvals queue loads — it returned a 500 before
- [ ] Bulk status update writes a funnel history entry
- [ ] Lead count reads 6399

---

## Step 7 — Only after a full business cycle

- [ ] Delete the Supabase project
- [ ] Delete the old Vercel deployment
- [ ] Set up automated backups for `crm-sales-db`
- [ ] Confirm a backup actually restores

Keep Supabase alive until then. Nothing in this migration writes back to it, so
rollback is just repointing the old deployment.
