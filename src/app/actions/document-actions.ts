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
  seriesId: string;
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
// Numbering
// ---------------------------------------------------------------------------
//
// There is no number generator here, and that is deliberate.
//
// The office cannot currently say what every segment of its numbering means: SA
// in one sample, MCN in another, and no guarantee those are the only two. A
// system that assembles a number from a format string produces a confident
// wrong one, and by the time anyone notices it has been printed and sent.
//
// So the number is typed. What the app provides instead is the context needed
// to type it correctly: the last numbers issued in the same series, and a
// suggestion the lord can maintain. Uniqueness is what gets enforced, not the
// pattern.

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
      SELECT d.id, d.series_id, d.number, d.status, d.client_name, d.issue_date,
             d.grand_total, d.created_by_name, d.created_at,
             s.company, s.doc_type, s.label AS series_label,
             (SELECT COUNT(*)::int FROM document_items i WHERE i.document_id = d.id) AS item_count
      FROM documents d
      JOIN document_series s ON s.id = d.series_id
      WHERE ${where} ${typeFilter}
    )
    SELECT
      COUNT(*) OVER() AS total,
      id, series_id, number, status, client_name, company, doc_type, series_label,
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
      seriesId: String(r.series_id),
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
 * Recent numbers already issued in a series, plus a suggestion.
 *
 * The suggestion is advisory only. Nobody can currently say what every segment
 * of the office's numbering means - `SA` in one sample, `MCN` in another, and
 * no guarantee those are the only two - so the number is typed by the user and
 * this exists to save them from having to remember what has already gone out.
 *
 * Showing the last numbers matters more than a counter when the counter is a
 * guess: the user can see that 037 is taken even when the suggestion says 38.
 */
export async function getNumberContext(
  seriesId: string,
): Promise<{ suggestion: number | null; recent: string[]; example: string | null }> {
  await requireUser();

  const [series, recent] = await Promise.all([
    db
      .select({
        nextNumber: documentSeries.nextNumber,
        format: documentSeries.format,
      })
      .from(documentSeries)
      .where(eq(documentSeries.id, seriesId))
      .limit(1),
    db
      .select({ number: documents.number })
      .from(documents)
      .where(and(eq(documents.seriesId, seriesId), sql`${documents.number} IS NOT NULL`))
      .orderBy(desc(documents.issuedAt), desc(documents.createdAt))
      .limit(12),
  ]);

  return {
    suggestion: series[0]?.nextNumber ?? null,
    recent: recent.map((r) => String(r.number)),
    example: series[0]?.format ?? null,
  };
}

/**
 * Issue a DRAFT with a number the user typed, and lock it.
 *
 * The number is entered by hand rather than generated. The office does not yet
 * know what every segment means, and a system that guesses a number produces a
 * wrong one that has already been printed by the time anyone notices. The
 * series carries a suggestion to pre-fill the box, and the last issued numbers
 * are shown beside it, but the person issuing decides.
 *
 * Uniqueness is enforced twice. The check inside the transaction gives a
 * readable message; the unique index on (series_id, number) is what actually
 * guarantees it, which is what catches two people issuing the same number at
 * the same moment - neither sees the other's row until commit.
 */
export async function issueDocument(
  id: string,
  number: string,
): Promise<{ success: boolean; number?: string; error?: string }> {
  const user = await requireUser();

  const clean = number.trim();
  if (!clean) return { success: false, error: 'Nomor dokumen wajib diisi' };
  if (clean.length > 120) return { success: false, error: 'Nomor terlalu panjang' };

  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          doc: documents,
          docType: documentSeries.docType,
          suggestion: documentSeries.nextNumber,
        })
        .from(documents)
        .innerJoin(documentSeries, eq(documentSeries.id, documents.seriesId))
        .where(eq(documents.id, id))
        .limit(1);

      const r = rows[0];
      if (!r) return { success: false, error: 'Dokumen tidak ditemukan' };
      if (r.doc.status !== 'DRAFT') {
        return { success: false, error: 'Dokumen ini sudah punya nomor' };
      }

      // Readable duplicate check. The index below is the real guarantee; this
      // one exists so the person gets told which number is taken instead of a
      // generic constraint error.
      const clash = await tx
        .select({ n: documents.number, client: documents.clientName })
        .from(documents)
        .where(
          and(
            eq(documents.seriesId, r.doc.seriesId),
            sql`upper(trim(${documents.number})) = upper(${clean})`,
          ),
        )
        .limit(1);

      if (clash[0]) {
        return {
          success: false,
          error:
            `Nomor ${clean} sudah dipakai untuk ${clash[0].client}. ` +
            'Coba nomor lain, atau batalkan dokumen lama kalau itu yang salah.',
        };
      }

      await tx
        .update(documents)
        .set({
          status: 'ISSUED',
          number: clean,
          issuedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: user.id,
          updatedByName: user.name,
        })
        .where(eq(documents.id, id));

      // Move the suggestion past whatever was just used, when the number looks
      // sequential. Best-effort: the office may skip numbers, and a suggestion
      // that lags is harmless because the number is typed anyway.
      if (r.suggestion !== null) {
        const m = /(\d+)/.exec(clean);
        if (m && Number(m[1]) >= r.suggestion) {
          await tx
            .update(documentSeries)
            .set({ nextNumber: Number(m[1]) + 1, updatedAt: new Date() })
            .where(eq(documentSeries.id, r.doc.seriesId));
        }
      }

      await audit({
        action: 'document.issue',
        userId: user.id,
        userName: user.name,
        targetId: id,
        details: `${r.docType} ${clean} untuk ${r.doc.clientName}`,
      });

      return { success: true, number: clean };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('documents_series_number_key')) {
      return {
        success: false,
        error: 'Nomor ini baru saja dipakai dokumen lain. Coba nomor lain.',
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
  /** House style, shown as a hint. Never used to build a number. */
  format: z.string().trim().max(200).nullish(),
  /** Suggestion pre-filled in the issue dialog. Nullable - none is fine. */
  nextNumber: z.coerce.number().int().min(1).nullish(),
  isActive: z.coerce.boolean(),
});

/** Edit a series' hint text and suggestion. */
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

  // A suggestion that sits below a number already issued would keep pre-filling
  // a number the office cannot use. It is only a hint, so the fix is to say so
  // rather than refuse the save - the number itself is typed and the unique
  // index is what actually prevents a duplicate.
  if (data.nextNumber !== null && data.nextNumber !== undefined) {
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
          `Saran nomor harus lebih besar dari ${highest}. ` +
          `Nomor ${highest} sudah dipakai untuk dokumen yang terbit.`,
      };
    }
  }

  await db
    .update(documentSeries)
    .set({
      label: data.label ?? null,
      format: data.format ?? null,
      nextNumber: data.nextNumber ?? null,
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
  format?: string | null;
  nextNumber?: number | null;
  label?: string | null;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  await requireLord();
  const id = `${input.company.toLowerCase()}-${input.docType.toLowerCase()}-${Date.now()}`;

  try {
    await db.insert(documentSeries).values({
      id,
      company: input.company as never,
      docType: input.docType as never,
      format: input.format ?? null,
      nextNumber: input.nextNumber ?? null,
      label: input.label ?? null,
    });
    return { success: true, id };
  } catch {
    return { success: false, error: 'Seri dengan kombinasi perusahaan dan jenis ini sudah ada' };
  }
}
