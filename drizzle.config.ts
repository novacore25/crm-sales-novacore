import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // enums.ts is listed explicitly, not just pulled in transitively via
  // schema.ts. Without it, drizzle-kit registers the enum *columns* but leaves
  // its `enums` map empty, and the generated migration references
  // "user_role" without ever emitting CREATE TYPE - which fails on a fresh
  // database.
  schema: ['./src/db/enums.ts', './src/db/schema.ts', './src/db/auth-schema.ts'],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Used only by drizzle-kit CLI (generate/migrate/studio). The running app
    // reads DATABASE_URL directly via src/db/index.ts.
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
