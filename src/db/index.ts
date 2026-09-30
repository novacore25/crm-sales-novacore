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

    // The server runs UTC; the team reads WIB. Pinning the session timezone
    // here means every timestamp this app stores or compares is UTC, and the
    // dashboard's WIB conversion stays a pure presentation concern.
    //
    // This is deliberately NOT done in a `pool.on('connect')` handler. That
    // fires while node-postgres is still finishing the handshake, so the
    // SET lands on a client that is already running another query - which is
    // where this deprecation warning came from:
    //
    //   Calling client.query() when the client is already executing a query
    //   is deprecated and will be removed in pg@9.0
    //
    // It works today and breaks on upgrade. `options` is sent as part of the
    // startup packet, so Postgres applies it before the pool considers the
    // connection usable and no second query is ever in flight.
    options: "-c timezone=UTC",
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
