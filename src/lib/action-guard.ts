/**
 * Turn a thrown server-action error into the `{ success: false }` shape the UI
 * already knows how to display.
 *
 * Without this, anything the database rejects escapes as an exception. React
 * then replaces the message with "Minified React error #441" in production,
 * because the real text might name a column or a constraint. The office sees
 * "Gagal menyimpan: Minified React error #441", which tells nobody anything, and
 * the actual cause only exists in the container log, which means reproducing the
 * bug and then going to look for it in the right window.
 *
 * So: log the whole error server-side, where it keeps its stack, and hand the
 * user something they can act on.
 */

/**
 * Postgres reports through the `message` property, and the useful part is after
 * the first colon - "error: column \"x\" does not exist". A duplicate key or a
 * foreign key violation gets named plainly instead, because those are the two
 * the office can actually do something about.
 */
export function describeDbError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  if (/duplicate key value violates unique constraint/i.test(raw)) {
    const constraint = raw.match(/constraint "([^"]+)"/i)?.[1];
    return constraint
      ? `Data sudah ada sebelumnya (tabel ${constraint}). Tidak bisa disimpan dua kali.`
      : 'Data sudah ada sebelumnya. Tidak bisa disimpan dua kali.';
  }

  if (/violates foreign key constraint/i.test(raw)) {
    return 'Data menunjuk ke data lain yang tidak ada. Periksa kembali yang dipilih.';
  }

  if (/violates not-null constraint/i.test(raw)) {
    const column = raw.match(/column "([^"]+)"/i)?.[1];
    return column
      ? `Kolom ${column} wajib diisi.`
      : 'Ada kolom wajib yang belum diisi.';
  }

  if (/column "([^"]+)" does not exist/i.test(raw)) {
    return `Ada kolom di kode yang tidak ada di database: ${raw.match(/column "([^"]+)"/i)![1]}. Ini bug, bukan salah input.`
  }

  const tail = raw.split(':').slice(1).join(':').trim();
  return tail && tail.length < 200 ? tail : raw.slice(0, 200);
}

/**
 * Wrap an action so a thrown error becomes a readable failure result.
 *
 * `console.error` keeps the original error object on the server, stack and all,
 * so the container log stays authoritative even though the user-facing text is a
 * summary.
 */
export function guardAction<A extends unknown[], R extends { success: boolean; error?: string }>(
  name: string,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error(`[action:${name}] gagal`, err);
      return { success: false, error: describeDbError(err) } as R;
    }
  };
}