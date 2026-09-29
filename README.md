# CRM Sales Novacore

Sales CRM for TNT — leads pipeline, funnel tracking, operational income
forecast, and task management.

Self-hosted on a single VPS: **Next.js + PostgreSQL + Drizzle ORM + Auth.js**,
deployed with Docker through Coolify.

---

## Stack

| | |
|---|---|
| Framework | Next.js 16.3.1 (App Router), React 19.2.8 |
| Database | PostgreSQL 17 — self-hosted, **not** internet-exposed |
| ORM | Drizzle ORM |
| Auth | Auth.js (NextAuth v5) + Google OAuth, database sessions |
| Styling | Tailwind CSS v4 |
| Deploy | Docker → Coolify |

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the system is put together, and what changed from the Supabase stack |
| [docs/DATABASE.md](docs/DATABASE.md) | ERD, every table and column, design decisions |
| [docs/MIGRATION.md](docs/MIGRATION.md) | Moving data from Supabase, with a verification checklist |
| [docs/SECURITY.md](docs/SECURITY.md) | Authorization model, credentials, the findings from the audit |

## Getting started

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL, AUTH_SECRET, Google OAuth
npm run dev
```

The app expects a Postgres with the schema already applied:

```bash
npm run db:migrate        # apply migrations from drizzle/
```

For a local database without installing Postgres:

```bash
docker compose up -d                       # Postgres on localhost:5433
# then, in another terminal:
docker compose run --rm migrate            # apply the schema
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate SQL from the Drizzle schema |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:push` | Push schema directly — **dev only**, writes no migration file |
| `npm run db:studio` | Browse the data in a GUI |

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | **Internal** Coolify URL. The database is not exposed publicly, so the external host will not connect. |
| `AUTH_SECRET` | yes | `openssl rand -base64 32`. Without it Auth.js refuses to start. |
| `AUTH_TRUST_HOST` | yes | `true` behind Coolify's proxy. |
| `AUTH_URL` | yes | Public origin; must match the Google OAuth redirect URI exactly. |
| `AUTH_GOOGLE_ID` | yes | From Google Cloud Console. |
| `AUTH_GOOGLE_SECRET` | yes | Never commit. |

Set these on the Coolify application resource, not in a file in the repo.

## Google OAuth setup

1. Google Cloud Console → **APIs & Services** → **Credentials**
2. Create an **OAuth 2.0 Client ID** of type *Web application*
3. Add authorised redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` (local)
   - `https://<your-domain>/api/auth/callback/google` (production)
4. Copy the client ID and secret into `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`

## Project layout

```
src/
├── auth.ts              Auth.js configuration
├── middleware.ts        Route protection and role gates
├── types.ts             DTOs shared between server and client
├── db/                  Drizzle schema, enums, connection pool
├── lib/                 Auth guards, permission matrix, utilities
├── app/
│   ├── (app)/           Authenticated shell (dashboard, leads, admin, …)
│   ├── actions/         Server actions — the only data-access layer
│   ├── api/auth/        Auth.js route handler
│   ├── login/           Google sign-in
│   └── pending/         Awaiting-approval screen
└── components/          Client components
drizzle/                 Generated SQL migrations (committed)
docs/                    Architecture, database, migration, security
```

## Key architectural rules

These are the things that will bite you if you forget them.

**All data access goes through a server action.** Client components receive data
as props and call actions on demand. There is no database credential in the
browser.

**Every mutation starts with a permission guard.**

```ts
export async function permanentlyDeleteLeads(ids: string[]) {
  const user = await requireLord();   // ← always first
  // role is read from the database, never from the request
}
```

The guards are `requireUser`, `requirePermission`, `requireLord`,
`requireLordOrAdmin` in [`src/lib/auth.ts`](src/lib/auth.ts). A UI check that
hides a button is not authorization.

**New leads go through `createLead`,** not a hand-rolled insert. It validates
input and seeds the opening funnel entry in the same transaction.

**Schema changes go through Drizzle.** Edit `src/db/schema.ts`, then
`npm run db:generate`. Do not hand-edit files in `drizzle/`.

**`drizzle.config.ts` lists `src/db/enums.ts` explicitly.** Without it,
`drizzle-kit` emits columns that reference `"user_role"` but never emits the
`CREATE TYPE`, and the migration fails on a fresh database.
