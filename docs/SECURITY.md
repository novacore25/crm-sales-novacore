# Security

## Summary

The application holds sales pipeline data for the whole team. It is deployed on
a single VPS with the database on the same host.

An audit of the previous stack — before it was migrated — found several
credential exposures and authorization gaps. All of them are addressed in the
current code; this document records what they were, so they are not
accidentally reintroduced.

---

## Authorization model

### Why this needed rebuilding

Under the Supabase stack, **Row Level Security was the only enforcement**. Every
client component queried the database directly using the Supabase anon key, and
the RLS policies in `supabase/migrations/fix_rls.sql` were the only thing
standing between a signed-in staff member and the entire dataset.

The `user.role === 'lord'` checks scattered through the components were JSX
render conditions. They hid buttons. They did not stop requests.

Worse, the RLS policies were unreliable in practice:

- `00000000000002_recreate_schema_text.sql` ran
  `ALTER TABLE … DISABLE ROW LEVEL SECURITY` on eleven tables — including
  `leads`, `funnel_history`, `tasks` and `oi_forecasts` — and never re-enabled
  them.
- Tables dropped and recreated by that migration (`lead_notes`,
  `role_permissions`) start with RLS off by default.
- `fix_rls.sql` created dozens of policies but never ran
  `ENABLE ROW LEVEL SECURITY`. A policy without RLS active does nothing.

The practical result was that the anon key could read and write the whole
database.

### How it works now

The app holds a direct Postgres connection, so there is no policy engine. Every
mutation is a server action that begins with an explicit guard:

```ts
import { requireLord, requirePermission, requireUser } from '@/lib/auth';

export async function setUserRole(userId: string, role: Role) {
  const actor = await requireLord();          // throws unless role === 'lord'
  // role comes from the database, never from the client
}
```

| Guard | Allows |
|---|---|
| `requireUser()` | Any authenticated, non-`pending` user |
| `requirePermission(key)` | Roles whose matrix grants that permission |
| `requireLord()` | `lord` only |
| `requireLordOrAdmin()` | `lord` or `admin` |

The role matrix lives in [`src/lib/permissions.ts`](../src/lib/permissions.ts)
and is mirrored in the `role_permissions` table for inspection.

### Route protection

[`src/middleware.ts`](../src/middleware.ts) gates routes using the signed
session cookie:

| Route | Rule |
|---|---|
| `/login`, `/api/auth/*` | Public |
| `/pending` | Any signed-in user |
| `/admin/*` | `admin` or `lord` |
| `/permissions` | `lord` only |
| Everything else | Any non-`pending` signed-in user |

Middleware is a convenience, not the boundary. Each page re-checks via
`requireUser()`, and every action re-checks permissions against the database —
a stale or forged cookie cannot grant a write.

The previous build had **no** route-level role check at all: `/permissions` was
a six-line page with no auth, reachable by any authenticated user typing the
URL, because the sidebar merely hid the nav link.

---

## Credential findings

These were present in the old repository's committed history. **They are
compromised and must be rotated regardless of this migration.**

| Finding | Impact | Status |
|---|---|---|
| `test_supa.cjs` contained a Supabase **service_role** JWT | Bypasses RLS entirely — full read/write to the production database | Rotate the key |
| 7 `scripts/*.cjs` files hardcoded the service-role key | Same | Rotate |
| 10 `scripts/*.cjs` files hardcoded a `postgresql://` string with the database password | Direct database access from anywhere the port was reachable | Rotate the password |
| A GitHub PAT was shared in plain text during setup | Repository access | Revoke and reissue |
| `.gitignore` excludes `.env*` but the credential files were `scripts/*.cjs` | Not caught by the ignore rules | Files deleted |

**Rotate all of these before cutover, not after.** The old database is still
live and serving traffic.

### Prevention

- `.env` and `.env.*` are gitignored; only `.env.example` is committed, and it
  contains no values.
- No file in the repository contains a live credential. The new repo is
  initialised with a clean history.
- Connection details live only as Coolify environment variables on the
  application resource.

---

## Network exposure

The database resource is created with **"Expose to Internet" off**. The
application and the database talk over Coolify's internal Docker network, so the
Postgres port is not reachable from the internet at all.

This is the single largest security improvement over the Supabase setup, where
the database was publicly reachable and protected only by a password that was
committed to git.

The application's HTTP port *is* exposed, through Coolify's proxy, so it gets a
TLS certificate automatically. The database never is.

---

## Sessions

Auth.js is configured with `strategy: 'database'`, not JWT cookies.

This is deliberate. A role change — an admin promoting a pending user, or
demoting a staff member — takes effect on that user's **next request**. With a
JWT, the old role would persist in the cookie until it expired, up to seven
days.

| | |
|---|---|
| Lifetime | 7 days |
| Refresh | Every 24 hours |
| Storage | `sessions` table |

`trustHost: true` is required because the app runs behind Coolify's proxy. Do
not set it to `false` in that deployment.

---

## Input validation

Every server action validates its input with Zod before it reaches SQL. This is
the boundary that PostgREST used to provide.

Two specific cases worth knowing about:

**Forecast field updates use an allowlist.** `updateOIForecastField` accepts a
`field` name and checks it against explicit sets before building the update:

```ts
if (EDITABLE_NUMERIC_FIELDS.has(field)) { … }
else if (EDITABLE_TEXT_FIELDS.has(field)) { … }
else return { success: false, error: `Field tidak dapat diubah: ${field}` };
```

The previous implementation derived the column name from a `fieldMap` object
that was missing an entry, so the "Camp. Ke" cell wrote to a column that did not
exist. An allowlist makes that class of bug impossible — anything unrecognised is
rejected before it becomes SQL.

**All multi-table writes are transactional.** The status-update path touches
`leads`, `funnel_history` and `lead_notes`; marking a forecast WIN touches
`oi_forecasts`, `leads` and `funnel_history`. Each is wrapped in
`db.transaction()`. Previously these were separate browser requests, so a
failure between them left the tables disagreeing.

---

## Error handling

Database errors are never rendered to the user.

The old lead-detail page did `JSON.stringify(error)` into its not-found state.
Supabase/PostgREST error payloads contain table names, column names and
constraint names — enough to map the schema by hand, on a page reachable by
guessing ids. The current code returns a plain 404.

Server-side errors go to the console; the client gets a short Indonesian message.

---

## Audit log

`global_audit_logs` records privileged operations: trash, permanent delete,
empty trash, role changes, approvals, CSV import, history clearing.

Writes are best-effort by design — `audit()` swallows its own errors so a failed
audit entry never rolls back or blocks the user's actual operation. The trade-off
is that an audit gap can go unrecorded; the alternative, failing the user's
operation because the audit insert had a problem, is worse.

---

## Checklist for a new deployment

- [ ] All Supabase credentials rotated (see the table above)
- [ ] `AUTH_SECRET` generated fresh with `openssl rand -base64 32`
- [ ] `AUTH_GOOGLE_SECRET` never committed, set only in Coolify
- [ ] Database resource: **"Expose to Internet" is off**
- [ ] Application resource: all six environment variables set
- [ ] Google OAuth redirect URI matches the production domain exactly
- [ ] First user promoted to `lord` via SQL before first login
- [ ] Automated backups enabled for the database resource
- [ ] A backup has been successfully restored at least once
