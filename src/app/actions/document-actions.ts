'use server';

import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { auditLogs, documentItems, documentSeries, documents } from '@/db/schema';
import { requireLord, requireUser } from '@/lib/auth';
import { z } from 'zod';

/**
 * Write an audit entry.
 *
 * Local rather than imported from lead-actions, which keeps its own copy
 * private. A failure here must not fail the action that triggered it: losing a
 * log line is a nuisance, refusing to issue an invoice over it is not.
 */
async function audit(params: {
  action: string;
  userId: string;
  userName: string;
  targetId?: string | null;
  details: string;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      action: params.action,
      userId: params.userId,
      userName: params.userName,
      targetId: params.targetId ?? null,
      details: params.details,
    });
  } catch (error) {
    console.error('[document] failed to record audit entry', error);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocumentItemInput {
  title: string;
  description?: string | null;
  period?: string | null;
  price: number;
}

export interface DocumentTotals {
  subtotal: number;
  taxRate: number | null;
  taxAmount: number;
  grandTotal: number;
}

export interface DocumentListRow {
  id: string;
  number: string | null;
  status: string;
  clientName: string;
  company: string;
  docType: string;
  seriesLabel: string | null;
  issueDate: string | null;
  grandTotal: number;
  itemCount: number;
  createdByName: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

const ROMAN = [
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
] as const;

function romanMonth(month: number): string {
  let n = month;
  let out = '';
  for (const [value, glyph] of ROMAN) {
    while (n >= value) {
      out += glyph;
      n -= value;
    }
  }
  return out;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/**
 * Turn a series format string and a counter into the printed number.
 *
 * The format is data, not code, because the three series in use disagree:
 *
 *   TNT   {seq:3}/{type}-TNT/{seg}/{roman}/{yy}   ->  037/QUO-TNT/SA/IX/26
 *   HYPE  {seq:3}/QUO-HYPE                        ->  003/QUO-HYPE
 *
 * An unknown placeholder is left as literal text rather than throwing, so a
 * typo in the format field shows up on the number instead of silently
 * producing a document with a wrong one.
 */
function formatNumber(
  format: string,
  opts: { seq: number; type: string; segment: string | null; issueDate: string | null },
): string {
  const width = /\{seq:(\d+)\}/.exec(format)?.[1];
  const d = opts.issueDate ? new Date(opts.issueDate) : null;
  const month = d && !Number.isNaN(d.getTime()) ? d.getMonth() + 1 : null;
  const year = d && !Number.isNaN(d.getTime()) ? d.getFullYear() : null;

  return format
    .replace(/\[\s*\]\s*/g, '')                       // tidy stray spaces in edit fields
    .replace(/\{seq(?::(\d+))?\}/g, (_, w) => pad(opts.seq, Number(w ?? width ?? 1)))
    .replace(/\{type\}/g, opts.type)
    .replace(/\{seg\}/g, opts.segment ?? '')
    .replace(/\{roman\}/g, month ? romanMonth(month) : '')
    .replace(/\{yy\}/g, year ? String(year).slice(-2) : '')
    .replace(/\/\s*\/\s*\//g, '/')
    .replace(/-\s*-/g, '-')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

/**
 * Subtotal, tax and grand total.
 *
 * The tax RATE is typed by the user and the arithmetic is done here. That split
 * is deliberate: the TNT sample has `PPN 11%` struck through with a different
 * figure in its place, and HYPE quotes 0,5%, so the rate is a human decision
 * that changes. The multiplication is not, and getting it wrong on a document
 * that carries a real bank account is not an acceptable failure mode.
 */
export function computeTotals(
  items: Pick<DocumentItemInput, 'price'>[],
  taxRate: number | null,
): DocumentTotals {
  const subtotal = items.reduce((sum, i) => sum + (Number(i.price) || 0), 0);
  const rate = taxRate === null || Number.isNaN(taxRate) ? 0 : taxRate;
  const taxAmount = (subtotal * rate) / 100;
  return {
    subtotal: round2(subtotal),
    taxRate,
    taxAmount: round2(taxAmount),
    // Below a cent the extra precision is noise, and a document whose printed
    // total disagrees with the one the client can add up loses the argument.
    grandTotal: round2(subtotal + taxAmount),
  };
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  title: z.string().trim().min(1, 'Nama item wajib diisi').max(300),
  description: z.string().max(8000).nullish(),
  period: z.string().max(120).nullish(),
  price: z.coerce.number().min(0, 'Harga tidak boleh negatif'),
});

const documentSchema = z.object({
  seriesId: z.string().min(1),
  clientName: z.string().trim().min(1, 'Nama klien wajib diisi').max(300),
  product: z.enum(['TNT', 'MCN', 'HYPE']).nullish(),
  issueDate: z.string().nullish(),
  period: z.string().max(120).nullish(),
  taxRate: z.coerce.number().min(0).max(100).nullish(),
  taxLabel: z.string().max(80).nullish(),
  terms: z.string().max(4000).nullish(),
  numberSegment: z.string().max(40).nullish(),
  approverName: z.string().max(300).nullish(),
  bankName: z.string().max(200).nullish(),
  bankAccountName: z.string().max(200).nullish(),
  bankAccountNumber: z.string().max(100).nullish(),
  bankBranch: z.string().max(200).nullish(),
  signatoryName: z.string().max(200).nullish(),
  signatoryTitle: z.string().max(200).nullish(),
  items: z.array(itemSchema).min(1, 'Minimal satu item'),
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Active series for the "new document" picker. */
export async function getDocumentSeries() {
  await requireUser();
  const rows = await db
    .select()
    .from(documentSeries)
    .where(eq(documentSeries.isActive, true))
    .orderBy(asc(documentSeries.company), asc(documentSeries.docType));
  return rows;
}

/**
 * The archive list.
 *
 * Server-paginated, like the leads table: the archive will hold every document
 * the office has ever printed, and sending all of it to the browser is the same
 * mistake the dashboard was fixed for.
 */
export async function getDocuments(opts: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  company?: string;
  docType?: string;
} = {}): Promise<{ rows: DocumentListRow[]; total: number }> {
  await requireUser();

  const page = Math.max(0, opts.page ?? 0);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));

  const conditions = [];
  if (opts.status && opts.status !== 'ALL') {
    conditions.push(eq(documents.status, opts.status as never));
  }
  if (opts.company && opts.company !== 'ALL') {
    conditions.push(eq(documentSeries.company, opts.company as never));
  }
  if (opts.docType && opts.docType !== 'ALL') {
    conditions.push(eq(documents.seriesId, 'never-match-this'));
  }
  if (opts.search?.trim()) {
    const term = `%${opts.search.trim()}%`;
    conditions.push(
      or(
        ilike(documents.number, term),
        ilike(documents.clientName, term),
        ilike(documents.numberSegment, term),
      )!,
    );
  }

  // docType is resolved through the series table, so it is filtered in the
  // join rather than on documents, which has no such column.
  const typeFilter =
    opts.docType && opts.docType !== 'ALL'
      ? sql`AND s.doc_type = ${opts.docType}`
      : sql``;

  const where = conditions.length
    ? and(...conditions, sql`TRUE`)
    : sql`TRUE`;

  const result = await db.execute(sql`
    WITH filtered AS (
      SELECT d.id, d.number, d.status, d.client_name, d.issue_date,
             d.grand_total, d.created_by_name, d.created_at,
             s.company, s.doc_type, s.label AS series_label,
             (SELECT COUNT(*)::int FROM document_items i WHERE i.document_id = d.id) AS item_count
      FROM documents d
      JOIN document_series s ON s.id = d.series_id
      WHERE ${where} ${typeFilter}
    )
    SELECT
      COUNT(*) OVER() AS total,
      id, number, status, client_name, company, doc_type, series_label,
      issue_date, grand_total, item_count, created_by_name, created_at
    FROM filtered
    ORDER BY created_at DESC
    LIMIT ${pageSize} OFFSET ${page * pageSize}
  `);

  const rows = (result as { rows?: Record<string, unknown>[] }).rows ?? [];
  return {
    total: rows.length > 0 ? Number(rows[0].total ?? 0) : 0,
    rows: rows.map((r) => ({
      id: String(r.id),
      number: r.number === null ? null : String(r.number),
      status: String(r.status),
      clientName: String(r.client_name),
      company: String(r.company),
      docType: String(r.doc_type),
      seriesLabel: r.series_label === null ? null : String(r.series_label),
      issueDate:
        r.issue_date === null ? null : new Date(String(r.issue_date)).toISOString(),
      grandTotal: Number(r.grand_total ?? 0),
      itemCount: Number(r.item_count ?? 0),
      createdByName: r.created_by_name === null ? null : String(r.created_by_name),
      createdAt: new Date(String(r.created_at)).toISOString(),
    })),
  };
}

/** One document with its items, for the detail and print views. */
export async function getDocument(id: string) {
  await requireUser();

  const [rows, itemRows] = await Promise.all([
    db
      .select({
        doc: documents,
        company: documentSeries.company,
        docType: documentSeries.docType,
        seriesLabel: documentSeries.label,
        format: documentSeries.format,
      })
      .from(documents)
      .innerJoin(documentSeries, eq(documentSeries.id, documents.seriesId))
      .where(eq(documents.id, id))
      .limit(1),
    db
      .select()
      .from(documentItems)
      .where(eq(documentItems.documentId, id))
      .orderBy(asc(documentItems.position)),
  ]);

  const r = rows[0];
  if (!r) return null;

  return {
    ...r.doc,
    company: r.company,
    docType: r.docType,
    seriesLabel: r.seriesLabel,
    format: r.format,
    subtotal: Number(r.doc.subtotal),
    taxRate: r.doc.taxRate === null ? null : Number(r.doc.taxRate),
    taxAmount: Number(r.doc.taxAmount),
    grandTotal: Number(r.doc.grandTotal),
    items: itemRows.map((i) => ({
      id: i.id,
      title: i.title,
      description: i.description,
      period: i.period,
      price: Number(i.price),
    })),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Create a DRAFT. No number is assigned, so abandoned drafts cost nothing. */
export async function createDocument(
  input: z.infer<typeof documentSchema>,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const user = await requireUser();
  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Data tidak valid' };
  }
  const data = parsed.data;

  const seriesRows = await db
    .select()
    .from(documentSeries)
    .where(eq(documentSeries.id, data.seriesId))
    .limit(1);
  const series = seriesRows[0];
  if (!series) return { success: false, error: 'Seri dokumen tidak ditemukan' };
  if (!series.isActive) return { success: false, error: 'Seri dokumen ini sedang nonaktif' };

  const totals = computeTotals(data.items, data.taxRate ?? null);
  const id = crypto.randomUUID();
  const shortType = series.docType === 'QUOTATION' ? 'QUO' : 'INV';

  await db.insert(documents).values({
    id,
    seriesId: series.id,
    status: 'DRAFT',
    clientName: data.clientName,
    product: data.product ?? null,
    issueDate: data.issueDate ?? null,
    period: data.period ?? null,
    subtotal: String(totals.subtotal),
    taxRate: data.taxRate === null || data.taxRate === undefined ? null : String(data.taxRate),
    taxLabel: data.taxLabel ?? null,
    taxAmount: String(totals.taxAmount),
    grandTotal: String(totals.grandTotal),
    terms: data.terms ?? null,
    numberSegment: data.numberSegment ?? null,
    approverName: data.approverName ?? null,
    bankName: data.bankName ?? null,
    bankAccountName: data.bankAccountName ?? null,
    bankAccountNumber: data.bankAccountNumber ?? null,
    bankBranch: data.bankBranch ?? null,
    signatoryName: data.signatoryName ?? null,
    signatoryTitle: data.signatoryTitle ?? null,
    templateKey: series.company.toLowerCase(),
    createdBy: user.id,
    createdByName: user.name,
    updatedBy: user.id,
    updatedByName: user.name,
  });

  await db.insert(documentItems).values(
    data.items.map((item, i) => ({
      id: crypto.randomUUID(),
      documentId: id,
      position: i,
      title: item.title,
      description: item.description ?? null,
      period: item.period ?? null,
      price: String(item.price),
    })),
  );

  return { success: true, id };
}

/**
 * Edit a DRAFT.
 *
 * Refuses anything that already holds a number. A printed number is a promise
 * to a client, and silently rewriting what sits behind it is how an archive
 * stops meaning anything. Issued documents are corrected by cancelling and
 * reissuing, or by filing a revision.
 */
export async function updateDocument(
  id: string,
  input: z.infer<typeof documentSchema>,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();
  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Data tidak valid' };
  }
  const data = parsed.data;

  const existing = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const doc = existing[0];
  if (!doc) return { success: false, error: 'Dokumen tidak ditemukan' };
  if (doc.status !== 'DRAFT') {
    return {
      success: false,
      error:
        'Dokumen ini sudah punya nomor dan tidak bisa diedit. ' +
        'Batalkan lalu buat nomor baru, atau buat revisi.',
    };
  }

  const totals = computeTotals(data.items, data.taxRate ?? null);

  await db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({
        clientName: data.clientName,
        product: data.product ?? null,
        issueDate: data.issueDate ?? null,
        period: data.period ?? null,
        subtotal: String(totals.subtotal),
        taxRate: data.taxRate === null || data.taxRate === undefined ? null : String(data.taxRate),
        taxLabel: data.taxLabel ?? null,
        taxAmount: String(totals.taxAmount),
        grandTotal: String(totals.grandTotal),
        terms: data.terms ?? null,
        numberSegment: data.numberSegment ?? null,
        approverName: data.approverName ?? null,
        bankName: data.bankName ?? null,
        bankAccountName: data.bankAccountName ?? null,
        bankAccountNumber: data.bankAccountNumber ?? null,
        bankBranch: data.bankBranch ?? null,
        signatoryName: data.signatoryName ?? null,
        signatoryTitle: data.signatoryTitle ?? null,
        updatedAt: new Date(),
        updatedBy: user.id,
        updatedByName: user.name,
      })
      .where(eq(documents.id, id));

    await tx.delete(documentItems).where(eq(documentItems.documentId, id));
    await tx.insert(documentItems).values(
      data.items.map((item, i) => ({
        id: crypto.randomUUID(),
        documentId: id,
        position: i,
        title: item.title,
        description: item.description ?? null,
        period: item.period ?? null,
        price: String(item.price),
      })),
    );
  });

  return { success: true };
}

/**
 * Issue a DRAFT: assign its number and lock it.
 *
 * The counter is read under a row lock and advanced in the same transaction as
 * the insert, so two people issuing at the same moment queue behind each other
 * rather than both receiving 038. If the insert fails the whole transaction
 * rolls back and the number is handed back, so a failure never burns a number
 * that no document claims.
 */
export async function issueDocument(
  id: string,
): Promise<{ success: boolean; number?: string; error?: string }> {
  const user = await requireUser();

  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          doc: documents,
          format: documentSeries.format,
          nextNumber: documentSeries.nextNumber,
          docType: documentSeries.docType,
        })
        .from(documents)
        .innerJoin(documentSeries, eq(documentSeries.id, documents.seriesId))
        .where(eq(documents.id, id))
        .limit(1)
        // FOR UPDATE on the series row: the second issuing transaction blocks
        // here until the first commits, then reads the number the first one
        // left behind. Without it both would read the same value.
        .for('update');

      const r = rows[0];
      if (!r) return { success: false, error: 'Dokumen tidak ditemukan' };
      if (r.doc.status !== 'DRAFT') {
        return { success: false, error: 'Dokumen ini sudah punya nomor' };
      }

      const seq = r.nextNumber;
      const shortType = r.docType === 'QUOTATION' ? 'QUO' : 'INV';
      const number = formatNumber(r.format, {
        seq,
        type: shortType,
        segment: r.doc.numberSegment,
        issueDate: r.doc.issueDate
          ? new Date(r.doc.issueDate).toISOString().slice(0, 10)
          : null,
      });

      await tx
        .update(documentSeries)
        .set({ nextNumber: seq + 1, updatedAt: new Date() })
        .where(eq(documentSeries.id, r.doc.seriesId));

      await tx
        .update(documents)
        .set({
          status: 'ISSUED',
          number,
          issuedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: user.id,
          updatedByName: user.name,
        })
        .where(eq(documents.id, id));

      await audit({
        action: 'document.issue',
        userId: user.id,
        userName: user.name,
        targetId: id,
        details: `${r.docType} ${number} untuk ${r.doc.clientName}`,
      });

      return { success: true, number };
    });
  } catch (error) {
    // The unique index on (series_id, number) is the backstop if two
    // transactions somehow reach the same value.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('documents_series_number_key')) {
      return {
        success: false,
        error:
          'Nomor ini sudah dipakai dokumen lain. Coba terbitkan ulang.',
      };
    }
    console.error('[document] issue failed', error);
    return { success: false, error: 'Gagal menerbitkan dokumen.' };
  }
}

/**
 * Cancel a document.
 *
 * The number is spent and never reused. A gap in the sequence is visible and
 * explainable; a number that means two different things is neither.
 */
export async function cancelDocument(
  id: string,
  reason?: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();

  const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const doc = rows[0];
  if (!doc) return { success: false, error: 'Dokumen tidak ditemukan' };
  if (doc.status === 'CANCELLED') return { success: true };

  await db
    .update(documents)
    .set({
      status: 'CANCELLED',
      terms: [doc.terms, reason ? `DIBATALKAN: ${reason}` : 'DIBATALKAN']
        .filter(Boolean)
        .join('\n'),
      updatedAt: new Date(),
      updatedBy: user.id,
      updatedByName: user.name,
    })
    .where(eq(documents.id, id));

  await audit({
    action: 'document.cancel',
    userId: user.id,
    userName: user.name,
    targetId: id,
    details: `${doc.number ?? '(tanpa nomor)'} untuk ${doc.clientName}${reason ? ` - ${reason}` : ''}`,
  });

  return { success: true };
}

/**
 * Delete a document. Lord only.
 *
 * Hard delete, and that is on purpose: this exists for the office testing the
 * system, not as a normal editing path. Issued documents are cancelled, never
 * deleted, because their number is already out in the world. Deleting one leaves
 * a hole in the archive that nobody can later explain, and a reused number that
 * two different clients now hold.
 *
 * requireLord throws rather than redirects, so this cannot be reached by an
 * admin who is not the lord, whatever the UI offers.
 */
export async function deleteDocument(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireLord();

  const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const doc = rows[0];
  if (!doc) return { success: false, error: 'Dokumen tidak ditemukan' };

  // document_items go with it by ON DELETE CASCADE.
  await db.delete(documents).where(eq(documents.id, id));

  await audit({
    action: 'document.delete',
    userId: user.id,
    userName: user.name,
    targetId: id,
    details: `${doc.number ?? '(tanpa nomor)'} - ${doc.clientName} (${doc.status}) dihapus oleh lord`,
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Series settings
// ---------------------------------------------------------------------------

const seriesSchema = z.object({
  label: z.string().max(200).nullish(),
  format: z.string().trim().min(1).max(200),
  nextNumber: z.coerce.number().int().min(1, 'Nomor urut minimal 1'),
  isActive: z.coerce.boolean(),
});

/** Edit a series' format and counter. */
export async function updateDocumentSeries(
  id: string,
  input: z.infer<typeof seriesSchema>,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireLord();
  const parsed = seriesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Data tidak valid' };
  }
  const data = parsed.data;

  const rows = await db.select().from(documentSeries).where(eq(documentSeries.id, id)).limit(1);
  if (!rows[0]) return { success: false, error: 'Seri tidak ditemukan' };

  // Moving the counter backwards below a number already issued would hand the
  // same number to a second document, which the unique index would catch - but
  // only after the office has already sent it to a client.
  const issued = await db
    .select({ n: documents.number })
    .from(documents)
    .where(eq(documents.seriesId, id));

  const highest = issued.reduce((max, r) => {
    const m = /(\d+)/.exec(r.n ?? '');
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);

  if (data.nextNumber <= highest) {
    return {
      success: false,
      error:
        `Nomor urut harus lebih besar dari ${highest}. ` +
        `Nomor ${highest} sudah dipakai untuk dokumen yang terbit.`,
    };
  }

  await db
    .update(documentSeries)
    .set({
      label: data.label ?? null,
      format: data.format,
      nextNumber: data.nextNumber,
      isActive: data.isActive,
      updatedAt: new Date(),
    })
    .where(eq(documentSeries.id, id));

  await audit({
    action: 'document.series.update',
    userId: user.id,
    userName: user.name,
    targetId: id,
    details: `format ${data.format}, next ${data.nextNumber}`,
  });

  return { success: true };
}

/** Create a new series. */
export async function createDocumentSeries(input: {
  company: string;
  docType: string;
  format: string;
  nextNumber: number;
  label?: string | null;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  await requireLord();
  const id = `${input.company.toLowerCase()}-${input.docType.toLowerCase()}-${Date.now()}`;

  try {
    await db.insert(documentSeries).values({
      id,
      company: input.company as never,
      docType: input.docType as never,
      format: input.format,
      nextNumber: input.nextNumber,
      label: input.label ?? null,
    });
    return { success: true, id };
  } catch {
    return { success: false, error: 'Seri dengan kombinasi perusahaan dan jenis ini sudah ada' };
  }
}
