import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as authSchema from './auth-schema';
import * as schema from './schema';

// Auth.js tables live alongside the domain schema so the adapter and the app
// share one connection and one query builder.
const fullSchema = { ...schema, ...authSchema };

declare global {
  // eslint-disable-next-line no-var
  var __dbPool: pg.Pool | undefined;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and fill in the ' +
        'internal URL shown in Coolify for the crm-sales-db resource.',
    );
  }

  const created = new pg.Pool({
    connectionString,
    // Coolify's internal Postgres sits behind a proxy; keepalives stop the
    // pool from handing out connections the server has already reaped.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  });

  // node-postgres returns NUMERIC (oid 1700) as a string to avoid precision
  // loss. Every revenue total in this app is well inside IEEE-754 safe range,
  // and the legacy client code did arithmetic directly on these values, so
  // parse them to numbers here. Without this, `+=` on deal values silently
  // becomes string concatenation.
  created.on('connect', (client) => {
    client.query("SET TIME ZONE 'UTC'");
  });

  return created;
}

export const pool: pg.Pool = global.__dbPool ?? (global.__dbPool = createPool());

/**
 * Parse NUMERIC columns to JS numbers at the driver level.
 * Applied once per pool so every query benefits.
 */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) =>
  value === null ? null : Number.parseFloat(value),
);
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) =>
  value === null ? null : Number.parseInt(value, 10),
);

export const db = drizzle(pool, { schema: fullSchema });

export type Database = typeof db;
