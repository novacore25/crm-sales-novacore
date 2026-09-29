# Live Schema Verification

Source of truth: the actual Supabase database, queried via the SQL Editor on
2026-09-29 (see `inspect-schema-full.sql`).

142 columns across 13 tables. **The app schema is a superset — Supabase has no
columns the app does not model.** That is the good news; the rest of this
document is where the old code was reading and writing things that do not
exist.

## Verified present in Supabase

These all match the Drizzle schema exactly:

`app_settings` · `edit_requests` · `funnel_history` · `global_audit_logs` ·
`global_targets` · `individual_targets` · `lead_notes` · `leads` ·
`oi_forecasts` · `oi_targets` · `role_permissions` · `tasks` · `users`

Plus `users.auth_id`, which the migration folder added and the app depends on
for user lookup.

## Columns the app schema adds, that Supabase does not have

| Column | Table | Why the app has it |
|---|---|---|
| `pic_name` | `leads` | PIC display. The dashboard search filter and several read paths expect it. |
| `assigned_to_name` | `tasks` | Denormalised assignee name, read by the lead detail task list. |
| `created_by_name` | `tasks` | Denormalised creator name. |
| `user_name` | `individual_targets` | Denormalised staff name for the targets table. |
| `is_deleted` | `oi_forecasts` | Soft delete for forecast rows. |
| `email_verified`, `image` | `users` | Required by the Auth.js Drizzle adapter. |

`accounts`, `sessions` and `verification_tokens` are entirely new — they are
the Auth.js session tables and do not correspond to anything in Supabase.

**None of this is a problem.** The new database is created from the Drizzle
schema, so all of these columns will exist there, and the new code populates
each of them on write:

| Column | Written by |
|---|---|
| `leads.pic_name` | `createLead` (`data.picName ?? user.name`) |
| `tasks.assigned_to_name` | `saveTask` (resolved from the users table) |
| `tasks.created_by_name` | `saveTask` |
| `individual_targets.user_name` | `setIndividualTarget` |
| `users.email_verified` | Auth.js adapter |

The only consequence for the data migration: `pg_dump --data-only` will emit
`INSERT` statements for Supabase's columns, none of which include the ones
above, so those stay `NULL` until the app writes them. That is the correct
starting state.

## What this proves about the old code

These are not theoretical drift. The columns simply are not there, so any query
naming them fails at the PostgREST layer.

### 1. `leads.pic_name` — the dashboard search is broken

`DashboardClient` built its search filter as:

```ts
query.or(`brand_name.ilike.%${search}%,pic_name.ilike.%${search}%,contact.ilike.%${search}%`)
```

`pic_name` is not a column, so Postgres rejects the whole predicate and the
search returns an error rather than results. **Search on the dashboard does not
work today.**

The new `getLeadsPage` filters on `brandName`, `contact` and `picName` — all of
which exist in the new schema.

### 2. `tasks.assigned_to_name` — assignee shows as "Unknown"

`LeadDetailClient` read `d.assigned_to_name` directly. It is always `undefined`,
so the task card falls back to `"Unknown"`. The new `getTasks` joins
`users` on `assigned_to` and prefers the stored name, then the joined one, so
the correct name resolves.

### 3. `oi_forecasts.is_deleted` — the cleanup scripts could not run

`scripts/fix_modals_logic*.cjs` filtered `.eq('is_deleted', false)`. That query
fails against a table without the column.

### 4. No `settings` table — the category registry never persisted

`useCategories` queried `settings` with a `list` column. Only `app_settings`
exists, and it has a `data` JSONB column. The query always threw, was swallowed
by a `catch`, and the UI fell back to a hardcoded array — which is why custom
categories appeared to work while never being stored.

The new code reads and writes `app_settings.data->'list'`.

## Combined with the earlier findings

The camelCase defects found in the source and the missing columns found here are
the same class of problem, and they compound:

| Feature | Defect | Confirmed by |
|---|---|---|
| Bulk status update | Writes `interestLevel`, `dateChated`, `funnelHistory` to `leads` | no such columns |
| Bulk trash | Writes `isDeleted`, `deletedAt`, `autoDeleteAt` | no such columns |
| Approvals page | `.order('timestamp')` | no such column; page 500s |
| Edit funnel history | Writes `date`, `by` | real names are `date_occurred`, `by_user_name` |
| Import CSV | Writes `source`, `notes`, `priority`, `funnel_history` | no such columns |
| Per-staff targets | Writes 6 columns into `oi_targets` | wrong table entirely |
| Task lead picker | `.select('id, name')` on `leads` | no `name` column |
| Campaign Ke-2 | `campaignNumber` missing from field map | writes a non-existent column |
| Dashboard search | Filters on `pic_name` | **column does not exist** |
| Category registry | Queries `settings` | **table does not exist** |

Every one of these is fixed in the rewrite. See `docs/MIGRATION.md` for the
verification checklist that walks each of them after cutover.
