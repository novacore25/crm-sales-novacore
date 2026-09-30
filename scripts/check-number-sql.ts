/**
 * Prints the SQL for the number-clash checks instead of running it.
 *
 * tsc and `next build` both passed while these queries were wrong before, so
 * the only way to know the SQL is right is to look at it.
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { documents } from '../src/db/schema';

const db = drizzle({ client: {} as never });

const seriesId = 'series-abc';
const number = '038/QUO-TNT/SA/IX/26';

const saveClash = db
  .select({ client: documents.clientName })
  .from(documents)
  .where(
    and(
      eq(documents.seriesId, seriesId),
      sql`upper(trim(${documents.number})) = upper(${number})`,
    ),
  )
  .limit(1);

const editClash = db
  .select({ client: documents.clientName })
  .from(documents)
  .where(
    and(
      eq(documents.seriesId, seriesId),
      ne(documents.id, 'doc-self'),
      sql`upper(trim(${documents.number})) = upper(${number})`,
    ),
  )
  .limit(1);

for (const [label, q] of [
  ['createDocument - clash check', saveClash],
  ['updateDocument - clash check (excludes self)', editClash],
] as const) {
  const { sql: text, params } = q.toSQL();
  console.log(`\n=== ${label} ===`);
  console.log(text);
  console.log('params:', JSON.stringify(params));
}
