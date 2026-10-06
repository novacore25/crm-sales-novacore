/**
 * The text the office reads when a save fails.
 *
 * This exists because of a dead end: a database rejection escaped as an
 * exception, React replaced the message with "Minified React error #441" in
 * production, and the only copy of the real cause was a line in a container log
 * nobody had looked at. The user was told "Gagal menyimpan: Minified React
 * error #441", which is not an answer.
 *
 * describeDbError is what turns the exception back into a sentence. If it starts
 * matching on the wrong part of the message, or silently falls through to
 * something unreadable, the failure is invisible again - so the shapes are pinned
 * here.
 */
import { describeDbError } from '../src/lib/action-guard';

let failed = 0;

function expect(label: string, input: unknown, mustContain: string) {
  const got = describeDbError(input);
  const ok = got.toLowerCase().includes(mustContain.toLowerCase());
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) {
    failed++;
    console.log(`       berisi "${mustContain}" tidak ditemukan`);
    console.log(`       hasilnya: "${got}"`);
  }
}

// A missing column is a bug in our code, and the message has to say so rather
// than implying the user typed something wrong.
expect(
  'kolom tidak ada',
  new Error('column "budget_ads" does not exist'),
  'budget_ads',
);
// A missing column is a bug in our code, so the message has to say that outright
// rather than leaving the user thinking they filled the form in wrong.
expect(
  'kolom tidak ada - dinyatakan sebagai bug',
  new Error('column "budget_ads" does not exist'),
  'ini bug',
);

expect(
  'duplicate key',
  new Error('duplicate key value violates unique constraint "oi_forecasts_month_product_key"'),
  'sudah ada',
);

expect('not null', new Error('null value in column "category" violates not-null constraint'), 'category');
expect('foreign key', new Error('insert or update on table "funnel_history" violates foreign key constraint'), 'tidak ada');
expect('tabel tidak ada', new Error('relation "oi_forecastz" does not exist'), 'oi_forecastz');

// A message with no recognisable shape must still come back as something a human
// can read, never empty.
expect('pesan tanpa pola', new Error('something went sideways at line 3'), 'something went sideways');

// A very long message must be cut, not dumped into a toast.
const long = new Error('x'.repeat(500));
const cut = describeDbError(long);
console.log(`  ${cut.length <= 200 ? 'ok  ' : 'FAIL'} pesan panjang dipotong (${cut.length} karakter)`);
if (cut.length > 200) failed++;

// Non-Error throws must not produce "undefined".
expect('bukan Error', { oops: true }, '[object Object]');

console.log();
if (failed) {
  console.log(`${failed} assertion gagal.`);
  process.exit(1);
}
console.log('Semua lulus.');