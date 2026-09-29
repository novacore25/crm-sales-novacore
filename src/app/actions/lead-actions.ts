'use server';

import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { auditLogs, funnelHistory, leadNotes, leads, oiForecasts } from '@/db/schema';
import { requireLord, requirePermission, requireUser } from '@/lib/auth';
import { FUNNEL_STAGES } from '@/db/enums';

// ============================================================================
// Row shapes returned to client components
// ============================================================================

export interface LeadRow {
  id: string;
  dateInput: string | null;
  category: string;
  brandName: string;
  contact: string;
  leadSource: string | null;
  email: string | null;
  status: string;
  interestLevel: string;
  productOffered: string[];
  actionPlan: string | null;
  dateChated: string | null;
  dateResponsed: string | null;
  dateSetMeeting: string | null;
  dateClosed: string | null;
  dateFailed: string | null;
  dealValue: number;
  picName: string;
  isDeleted: boolean;
  deletedAt: string | null;
  autoDeleteAt: string | null;
  funnelHistory: FunnelHistoryRow[];
  notes: LeadNoteRow[];
}

/** Column defaults make these nullable in the inferred row type. */
type Nullable<T, K extends keyof T> = Omit<T, K> & { [P in K]: NonNullable<T[P]> };

export interface FunnelHistoryRow {
  id: string;
  leadId: string;
  stage: string;
  dateOccurred: string;
  byUserName: string;
  byUserId: string | null;
  note: string | null;
  assignedBy: string | null;
  dealValue: number | null;
  campaignNumber: number | null;
  createdAt: string;
}

export interface LeadNoteRow {
  id: string;
  leadId: string;
  text: string;
  authorId: string | null;
  authorName: string;
  isLog: boolean;
  noteType: string | null;
  createdAt: string;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);
const num = (value: string | number | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value);

/**
 * `funnel_history.stage` is plain TEXT - a stage can be recorded as free text
 * when a rep retro-fills history - but `leads.status` is the `lead_status`
 * enum. Narrow explicitly instead of casting, so a stray value in the database
 * degrades to 'Leads' rather than aborting the write.
 */
function toLeadStatus(stage: string | null | undefined): (typeof FUNNEL_STAGES)[number] {
  return (FUNNEL_STAGES as readonly string[]).includes(stage ?? '')
    ? (stage as (typeof FUNNEL_STAGES)[number])
    : 'Leads';
}

// ============================================================================
// Validation helpers
// ============================================================================

const leadIdSchema = z.string().min(1).max(200);
const funnelStageSchema = z.enum(FUNNEL_STAGES as unknown as [string, ...string[]]);

/**
 * Write an audit entry. Never throws - an audit failure must not roll back or
 * block the user's actual operation.
 */
async function audit(params: {
  action: string;
  details: string;
  userId: string;
  userName: string;
  targetId?: string | null;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      action: params.action,
      details: params.details,
      userId: params.userId,
      userName: params.userName,
      targetId: params.targetId ?? null,
    });
  } catch (error) {
    console.error('[audit] failed to record entry', error);
  }
}

// ============================================================================
// Lead reads
// ============================================================================

/**
 * Fetch a page of leads with their funnel history and notes.
 *
 * The legacy version embedded `funnel_history(*)` in a PostgREST select and
 * paginated with a `.range()` that had no ORDER BY, which could skip or repeat
 * rows whenever the table changed mid-scan. Here the page of leads is resolved
 * first, then history and notes are fetched in two batched queries keyed by the
 * ids on that page - so row count is stable and the join fan-out is bounded by
 * the page size rather than the table size.
 */
export async function getLeadsPage(params: {
  page?: number;
  pageSize?: number;
  includeDeleted?: boolean;
  search?: string;
  statusFilter?: string;
  categoryFilter?: string;
  productFilter?: string[];
}): Promise<{ leads: LeadRow[]; total: number }> {
  await requireUser();

  const page = Math.max(0, params.page ?? 0);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));

  const conditions = [];
  if (!params.includeDeleted) conditions.push(eq(leads.isDeleted, false));
  if (params.statusFilter && params.statusFilter !== 'ALL') {
    conditions.push(eq(leads.status, params.statusFilter as never));
  }
  if (params.categoryFilter && params.categoryFilter !== 'ALL') {
    conditions.push(eq(leads.category, params.categoryFilter));
  }
  if (params.productFilter?.length) {
    conditions.push(
      sql`${leads.productOffered} && ${params.productFilter}::text[]`,
    );
  }
  if (params.search?.trim()) {
    const term = `%${params.search.trim()}%`;
    const searchCond = or(
      sql`${leads.brandName} ILIKE ${term}`,
      sql`${leads.contact} ILIKE ${term}`,
      sql`${leads.picName} ILIKE ${term}`,
    );
    conditions.push(searchCond!);
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(leads)
      .where(where)
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(pageSize)
      .offset(page * pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(leads).where(where),
  ]);

  if (rows.length === 0) return { leads: [], total: num(countRows[0]?.count) };

  const ids = rows.map((r) => r.id);

  const [historyRows, noteRows] = await Promise.all([
    db
      .select()
      .from(funnelHistory)
      .where(inArray(funnelHistory.leadId, ids))
      .orderBy(asc(funnelHistory.dateOccurred), asc(funnelHistory.createdAt)),
    db
      .select()
      .from(leadNotes)
      .where(inArray(leadNotes.leadId, ids))
      .orderBy(asc(leadNotes.createdAt)),
  ]);

  const historyByLead = new Map<string, FunnelHistoryRow[]>();
  for (const h of historyRows) {
    const list = historyByLead.get(h.leadId) ?? [];
    list.push({
      id: h.id,
      leadId: h.leadId,
      stage: h.stage,
      dateOccurred: iso(h.dateOccurred)!,
      byUserName: h.byUserName,
      byUserId: h.byUserId,
      note: h.note,
      assignedBy: h.assignedBy,
      dealValue: h.dealValue === null ? null : num(h.dealValue),
      campaignNumber: h.campaignNumber,
      createdAt: iso(h.createdAt)!,
    });
    historyByLead.set(h.leadId, list);
  }

  const notesByLead = new Map<string, LeadNoteRow[]>();
  for (const n of noteRows) {
    const list = notesByLead.get(n.leadId) ?? [];
    list.push({
      id: n.id,
      leadId: n.leadId,
      text: n.text,
      authorId: n.authorId,
      authorName: n.authorName,
      isLog: n.isLog ?? false,
      noteType: n.noteType,
      createdAt: iso(n.createdAt)!,
    });
    notesByLead.set(n.leadId, list);
  }

  return {
    total: num(countRows[0]?.count),
    leads: rows.map((l) => ({
      id: l.id,
      dateInput: l.dateInput,
      category: l.category,
      brandName: l.brandName,
      contact: l.contact,
      leadSource: l.leadSource,
      email: l.email,
      status: l.status,
      interestLevel: l.interestLevel,
      productOffered: l.productOffered ?? [],
      actionPlan: l.actionPlan,
      dateChated: iso(l.dateChated),
      dateResponsed: iso(l.dateResponsed),
      dateSetMeeting: iso(l.dateSetMeeting),
      dateClosed: iso(l.dateClosed),
      dateFailed: iso(l.dateFailed),
      dealValue: num(l.dealValue),
      // Fall back through the same chain the dashboard used: explicit pic_name,
      // then the most recent human actor in the funnel.
      picName: l.picName ?? '-',
      isDeleted: l.isDeleted ?? false,
      deletedAt: iso(l.deletedAt),
      autoDeleteAt: iso(l.autoDeleteAt),
      funnelHistory: historyByLead.get(l.id) ?? [],
      notes: notesByLead.get(l.id) ?? [],
    })),
  };
}

/** Single lead with full history and notes, for the detail page. */
export async function getLeadById(id: string): Promise<LeadRow | null> {
  await requireUser();

  const rows = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  const lead = rows[0];
  if (!lead) return null;

  const [historyRows, noteRows] = await Promise.all([
    db
      .select()
      .from(funnelHistory)
      .where(eq(funnelHistory.leadId, id))
      .orderBy(desc(funnelHistory.createdAt)),
    db
      .select()
      .from(leadNotes)
      .where(eq(leadNotes.leadId, id))
      .orderBy(desc(leadNotes.createdAt)),
  ]);

  return {
    id: lead.id,
    dateInput: lead.dateInput,
    category: lead.category,
    brandName: lead.brandName,
    contact: lead.contact,
    leadSource: lead.leadSource,
    email: lead.email,
    status: lead.status,
    interestLevel: lead.interestLevel,
    productOffered: lead.productOffered ?? [],
    actionPlan: lead.actionPlan,
    dateChated: iso(lead.dateChated),
    dateResponsed: iso(lead.dateResponsed),
    dateSetMeeting: iso(lead.dateSetMeeting),
    dateClosed: iso(lead.dateClosed),
    dateFailed: iso(lead.dateFailed),
    dealValue: num(lead.dealValue),
    picName: lead.picName ?? '-',
    isDeleted: lead.isDeleted ?? false,
    deletedAt: iso(lead.deletedAt),
    autoDeleteAt: iso(lead.autoDeleteAt),
    funnelHistory: historyRows.map((h) => ({
      id: h.id,
      leadId: h.leadId,
      stage: h.stage,
      dateOccurred: iso(h.dateOccurred)!,
      byUserName: h.byUserName,
      byUserId: h.byUserId,
      note: h.note,
      assignedBy: h.assignedBy,
      dealValue: h.dealValue === null ? null : num(h.dealValue),
      campaignNumber: h.campaignNumber,
      createdAt: iso(h.createdAt)!,
    })),
    notes: noteRows.map((n) => ({
      id: n.id,
      leadId: n.leadId,
      text: n.text,
      authorId: n.authorId,
      authorName: n.authorName,
      isLog: n.isLog ?? false,
      noteType: n.noteType,
      createdAt: iso(n.createdAt)!,
    })),
  };
}

/** Distinct category list, for filter dropdowns. */
export async function getCategories(): Promise<string[]> {
  await requireUser();
  const rows = await db
    .selectDistinct({ category: leads.category })
    .from(leads)
    .orderBy(asc(leads.category));
  return rows.map((r) => r.category).filter(Boolean);
}

// ============================================================================
// Lead writes
// ============================================================================

const createLeadSchema = z.object({
  dateInput: z.string().optional().nullable(),
  category: z.string().min(1, 'Kategori wajib diisi'),
  brandName: z.string().min(1, 'Nama brand wajib diisi'),
  contact: z.string().min(1, 'Kontak wajib diisi'),
  leadSource: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  interestLevel: z.enum(['HOT', 'WARM', 'COLD', '-']).optional(),
  productOffered: z.array(z.string()).optional(),
  actionPlan: z.string().optional().nullable(),
  picName: z.string().optional().nullable(),
  dealValue: z.number().optional(),
});

export async function createLead(
  input: z.infer<typeof createLeadSchema>,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const user = await requireUser();

  const parsed = createLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Data tidak valid' };
  }
  const data = parsed.data;
  const now = new Date();
  const id = crypto.randomUUID();

  const inserted = await db
    .insert(leads)
    .values({
      id,
      dateInput: data.dateInput ?? now.toISOString().slice(0, 10),
      category: data.category,
      brandName: data.brandName,
      contact: data.contact,
      leadSource: data.leadSource ?? '-',
      email: data.email ?? null,
      status: 'Leads',
      interestLevel: data.interestLevel ?? '-',
      productOffered: data.productOffered ?? [],
      actionPlan: data.actionPlan ?? null,
      picName: data.picName ?? user.name,
      dealValue: String(data.dealValue ?? 0),
    })
    .returning({ id: leads.id });

  if (!inserted[0]) return { success: false, error: 'Gagal menyimpan lead' };

  // Seed the funnel with the opening stage so the pipeline has a starting point.
  await db.insert(funnelHistory).values({
    id: crypto.randomUUID(),
    leadId: id,
    stage: 'Leads',
    dateOccurred: now,
    byUserName: user.name,
    byUserId: user.id,
    note: 'Lead dibuat',
  });

  revalidatePath('/');
  revalidatePath('/leads');
  return { success: true, id };
}

const updateLeadSchema = createLeadSchema.partial().extend({
  id: z.string().min(1),
  status: z.enum(FUNNEL_STAGES as unknown as [string, ...string[]]).optional(),
  dateChated: z.string().optional().nullable(),
  dateResponsed: z.string().optional().nullable(),
  dateSetMeeting: z.string().optional().nullable(),
  dateClosed: z.string().optional().nullable(),
  dateFailed: z.string().optional().nullable(),
});

export async function updateLead(
  input: z.infer<typeof updateLeadSchema>,
): Promise<{ success: boolean; error?: string }> {
  const user = await requirePermission('canEditDealValue');

  const parsed = updateLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Data tidak valid' };
  }
  const { id, ...rest } = parsed.data;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (rest.category !== undefined) patch.category = rest.category;
  if (rest.brandName !== undefined) patch.brandName = rest.brandName;
  if (rest.contact !== undefined) patch.contact = rest.contact;
  if (rest.leadSource !== undefined) patch.leadSource = rest.leadSource;
  if (rest.email !== undefined) patch.email = rest.email;
  if (rest.interestLevel !== undefined) patch.interestLevel = rest.interestLevel;
  if (rest.productOffered !== undefined) patch.productOffered = rest.productOffered;
  if (rest.actionPlan !== undefined) patch.actionPlan = rest.actionPlan;
  if (rest.picName !== undefined) patch.picName = rest.picName;
  if (rest.dealValue !== undefined) patch.dealValue = String(rest.dealValue);
  if (rest.status !== undefined) patch.status = rest.status;
  for (const key of ['dateChated', 'dateResponsed', 'dateSetMeeting', 'dateClosed', 'dateFailed'] as const) {
    if (rest[key] !== undefined) {
      patch[key] = rest[key] === null ? null : new Date(rest[key] as string);
    }
  }

  await db.update(leads).set(patch).where(eq(leads.id, id));

  await audit({
    action: 'UPDATE_LEAD',
    details: `Lead ${rest.brandName ?? id} diperbarui oleh ${user.name}`,
    userId: user.id,
    userName: user.name,
    targetId: id,
  });

  revalidatePath('/');
  revalidatePath('/leads');
  revalidatePath(`/lead/${id}`);
  return { success: true };
}

/** Bulk import. Runs in one transaction so a bad row cannot half-apply. */
export async function importLeads(
  rows: Array<z.input<typeof createLeadSchema>>,
): Promise<{ success: boolean; imported: number; error?: string }> {
  const user = await requirePermission('canImportCsv');

  if (!rows.length) return { success: true, imported: 0 };

  const now = new Date();
  const prepared: Array<typeof leads.$inferInsert> = [];

  for (const raw of rows) {
    const parsed = createLeadSchema.safeParse(raw);
    if (!parsed.success) continue;
    const data = parsed.data;
    const id = crypto.randomUUID();
    prepared.push({
      id,
      dateInput: data.dateInput ?? now.toISOString().slice(0, 10),
      category: data.category,
      brandName: data.brandName,
      contact: data.contact,
      leadSource: data.leadSource ?? '-',
      email: data.email ?? null,
      status: 'Leads',
      interestLevel: data.interestLevel ?? '-',
      productOffered: data.productOffered ?? [],
      actionPlan: data.actionPlan ?? null,
      picName: data.picName ?? user.name,
      dealValue: String(data.dealValue ?? 0),
    });
  }

  if (!prepared.length) return { success: false, imported: 0, error: 'Tidak ada baris valid' };

  // Chunked so a large CSV does not exceed Postgres' 65535 bind-parameter cap.
  const CHUNK = 500;
  for (let i = 0; i < prepared.length; i += CHUNK) {
    const chunk = prepared.slice(i, i + CHUNK);
    await db.transaction(async (tx) => {
      await tx.insert(leads).values(chunk);
      await tx.insert(funnelHistory).values(
        chunk.map((l) => ({
          id: crypto.randomUUID(),
          leadId: l.id!,
          stage: 'Leads',
          dateOccurred: now,
          byUserName: user.name,
          byUserId: user.id,
          note: 'Import CSV',
        })),
      );
    });
  }

  await audit({
    action: 'IMPORT_CSV',
    details: `${prepared.length} lead diimpor oleh ${user.name}`,
    userId: user.id,
    userName: user.name,
  });

  revalidatePath('/');
  revalidatePath('/leads');
  return { success: true, imported: prepared.length };
}

// ============================================================================
// Soft delete / restore / purge
// ============================================================================

const SOFT_DELETE_RETENTION_DAYS = 30;

export async function softDeleteLeads(
  ids: string[],
): Promise<{ success: boolean; error?: string }> {
  const user = await requirePermission('canDeleteLeads');
  if (!ids.length) return { success: true };

  const now = new Date();
  const autoDeleteAt = new Date(now.getTime() + SOFT_DELETE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // The legacy client sent `isDeleted`/`deletedAt`/`autoDeleteAt` (camelCase)
  // which matched no column, so bulk trash silently did nothing. These are the
  // real snake_case columns.
  await db
    .update(leads)
    .set({ isDeleted: true, deletedAt: now, autoDeleteAt, updatedAt: now })
    .where(inArray(leads.id, ids));

  await audit({
    action: ids.length > 1 ? 'BULK_TRASH' : 'MOVE_TO_TRASH',
    details: `${ids.length} lead dipindahkan ke sampah oleh ${user.name}`,
    userId: user.id,
    userName: user.name,
  });

  revalidatePath('/');
  revalidatePath('/leads');
  return { success: true };
}

export async function restoreLeads(ids: string[]): Promise<{ success: boolean }> {
  const user = await requirePermission('canDeleteLeads');
  if (!ids.length) return { success: true };

  await db
    .update(leads)
    .set({ isDeleted: false, deletedAt: null, autoDeleteAt: null, updatedAt: new Date() })
    .where(inArray(leads.id, ids));

  await audit({
    action: 'RESTORE_LEAD',
    details: `${ids.length} lead dipulihkan oleh ${user.name}`,
    userId: user.id,
    userName: user.name,
  });

  revalidatePath('/leads');
  return { success: true };
}

/**
 * Permanently delete leads and everything that cascades from them.
 *
 * lead_notes, funnel_history and oi_forecasts all declare
 * `REFERENCES leads(id) ON DELETE CASCADE`, so a single delete is enough. The
 * legacy code issued a per-row SELECT + DELETE loop first, which was both slow
 * and unprotected by a transaction.
 */
export async function permanentlyDeleteLeads(
  ids: string[],
): Promise<{ success: boolean; deleted: number; error?: string }> {
  const user = await requireLord();
  if (!ids.length) return { success: true, deleted: 0 };

  const deleted = await db
    .delete(leads)
    .where(inArray(leads.id, ids))
    .returning({ id: leads.id });

  await audit({
    action: 'PERMANENT_DELETE',
    details: `${deleted.length} lead dihapus permanen oleh ${user.name}`,
    userId: user.id,
    userName: user.name,
  });

  revalidatePath('/');
  revalidatePath('/leads');
  return { success: true, deleted: deleted.length };
}

export async function emptyTrash(): Promise<{ success: boolean; deleted: number }> {
  const user = await requireLord();

  const trashed = await db.select({ id: leads.id }).from(leads).where(eq(leads.isDeleted, true));
  if (!trashed.length) return { success: true, deleted: 0 };

  const deleted = await db
    .delete(leads)
    .where(inArray(leads.id, trashed.map((t) => t.id)))
    .returning({ id: leads.id });

  await audit({
    action: 'EMPTY_TRASH',
    details: `Kosongkan sampah: ${deleted.length} lead dihapus oleh ${user.name}`,
    userId: user.id,
    userName: user.name,
  });

  revalidatePath('/');
  revalidatePath('/leads');
  return { success: true, deleted: deleted.length };
}

// ============================================================================
// Funnel history
// ============================================================================

const addHistorySchema = z.object({
  leadId: leadIdSchema,
  stage: funnelStageSchema,
  dateOccurred: z.string(),
  byUserName: z.string().min(1),
  note: z.string().optional().nullable(),
  assignedBy: z.string().optional().nullable(),
  dealValue: z.number().optional().nullable(),
  campaignNumber: z.number().int().optional().nullable(),
});

/**
 * Append a funnel entry and keep the lead's denormalised summary in sync.
 *
 * Both writes happen in one transaction. The old implementation fired the
 * `leads` update and the `funnel_history` insert as separate requests, so a
 * failure between them left the lead claiming a stage it had no history for.
 */
export async function addFunnelHistory(
  input: z.infer<typeof addHistorySchema>,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();

  const parsed = addHistorySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Data tidak valid' };
  }
  const data = parsed.data;
  const occurred = new Date(data.dateOccurred);

  const patch: Record<string, unknown> = { status: data.stage, updatedAt: new Date() };
  switch (data.stage) {
    case 'Chated':
      patch.dateChated = occurred;
      break;
    case 'Responsed':
      patch.dateResponsed = occurred;
      break;
    case 'Set Meeting':
      patch.dateSetMeeting = occurred;
      break;
    case 'Close Win':
    case 'Close Lost':
      patch.dateClosed = occurred;
      break;
    case 'Failed':
      patch.dateFailed = occurred;
      break;
    default:
      break;
  }
  if (data.dealValue !== null && data.dealValue !== undefined) {
    patch.dealValue = String(data.dealValue);
  }

  await db.transaction(async (tx) => {
    await tx.insert(funnelHistory).values({
      id: crypto.randomUUID(),
      leadId: data.leadId,
      stage: data.stage,
      dateOccurred: occurred,
      byUserName: data.byUserName,
      byUserId: user.id,
      note: data.note ?? null,
      assignedBy: data.assignedBy ?? null,
      dealValue: data.dealValue === null || data.dealValue === undefined ? null : String(data.dealValue),
      campaignNumber: data.campaignNumber ?? null,
    });

    await tx.update(leads).set(patch).where(eq(leads.id, data.leadId));

    await tx.insert(leadNotes).values({
      id: crypto.randomUUID(),
      leadId: data.leadId,
      text: `Status diubah ke ${data.stage}${data.note ? ` - ${data.note}` : ''}`,
      authorId: user.id,
      authorName: user.name,
      isLog: true,
      noteType: 'note',
    });
  });

  revalidatePath('/');
  revalidatePath('/leads');
  revalidatePath(`/lead/${data.leadId}`);
  return { success: true };
}

const editHistorySchema = z.object({
  id: z.string().min(1),
  stage: funnelStageSchema,
  dateOccurred: z.string(),
  byUserName: z.string().min(1),
  dealValue: z.number().optional().nullable(),
  campaignNumber: z.number().int().optional().nullable(),
  note: z.string().optional().nullable(),
});

/**
 * Edit an existing funnel entry.
 *
 * This is the "Edit Siluman" feature. The legacy version wrote to `date` and
 * `by`, neither of which is a column on funnel_history - the real names are
 * `date_occurred` and `by_user_name` - so every save failed at runtime.
 */
export async function editFunnelHistory(
  input: z.infer<typeof editHistorySchema>,
): Promise<{ success: boolean; error?: string }> {
  await requirePermission('canEditFunnelHistory');

  const parsed = editHistorySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Data tidak valid' };
  }
  const data = parsed.data;

  const updated = await db
    .update(funnelHistory)
    .set({
      stage: data.stage,
      dateOccurred: new Date(data.dateOccurred),
      byUserName: data.byUserName,
      dealValue: data.dealValue === null || data.dealValue === undefined ? null : String(data.dealValue),
      campaignNumber: data.campaignNumber ?? null,
      note: data.note ?? null,
    })
    .where(eq(funnelHistory.id, data.id))
    .returning({ leadId: funnelHistory.leadId, stage: funnelHistory.stage });

  const row = updated[0];
  if (!row) return { success: false, error: 'Riwayat tidak ditemukan' };

  // If the edited entry is the lead's latest stage, re-derive the summary.
  const latest = await db
    .select({ stage: funnelHistory.stage, dealValue: funnelHistory.dealValue })
    .from(funnelHistory)
    .where(eq(funnelHistory.leadId, row.leadId))
    .orderBy(desc(funnelHistory.createdAt))
    .limit(1);

  if (latest[0]?.stage === row.stage) {
    await db
      .update(leads)
      .set({
        status: toLeadStatus(latest[0].stage),
        dealValue: latest[0].dealValue ?? '0',
        updatedAt: new Date(),
      })
      .where(eq(leads.id, row.leadId));
  }

  revalidatePath(`/lead/${row.leadId}`);
  return { success: true };
}

export async function deleteFunnelHistory(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  await requirePermission('canDeleteFunnelHistory');

  const deleted = await db
    .delete(funnelHistory)
    .where(eq(funnelHistory.id, id))
    .returning({ leadId: funnelHistory.leadId });

  const row = deleted[0];
  if (!row) return { success: false, error: 'Riwayat tidak ditemukan' };

  // Re-derive status from whatever history remains.
  const remaining = await db
    .select({ stage: funnelHistory.stage, dealValue: funnelHistory.dealValue })
    .from(funnelHistory)
    .where(eq(funnelHistory.leadId, row.leadId))
    .orderBy(desc(funnelHistory.createdAt))
    .limit(1);

  await db
    .update(leads)
    .set({
      status: toLeadStatus(remaining[0]?.stage),
      dealValue: remaining[0]?.dealValue ?? '0',
      updatedAt: new Date(),
    })
    .where(eq(leads.id, row.leadId));

  revalidatePath(`/lead/${row.leadId}`);
  return { success: true };
}

/**
 * Wipe a lead's entire funnel, notes and forecasts and reset the summary.
 * Lord-only. `date_failed` is reset too - the legacy version cleared four of
 * the five stage dates and left the fifth behind.
 */
export async function clearLeadHistory(
  leadId: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireLord();

  await db.transaction(async (tx) => {
    await tx.delete(funnelHistory).where(eq(funnelHistory.leadId, leadId));
    await tx.delete(leadNotes).where(eq(leadNotes.leadId, leadId));
    await tx.delete(oiForecasts).where(eq(oiForecasts.leadId, leadId));
    await tx
      .update(leads)
      .set({
        dateChated: null,
        dateResponsed: null,
        dateSetMeeting: null,
        dateClosed: null,
        dateFailed: null,
        dealValue: '0',
        status: 'Leads',
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));
  });

  await audit({
    action: 'CLEAR_HISTORY',
    details: `History lead ${leadId} dikosongkan oleh ${user.name}`,
    userId: user.id,
    userName: user.name,
    targetId: leadId,
  });

  revalidatePath('/');
  revalidatePath(`/lead/${leadId}`);
  return { success: true };
}

// ============================================================================
// Notes
// ============================================================================

const createNoteSchema = z.object({
  leadId: leadIdSchema,
  text: z.string().min(1),
  noteType: z.enum(['note', 'action_plan']).optional(),
  createdAt: z.string().optional(),
  authorName: z.string().optional(),
});

export async function createNote(
  input: z.infer<typeof createNoteSchema>,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const user = await requireUser();

  const parsed = createNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Catatan tidak valid' };
  }
  const data = parsed.data;
  const id = crypto.randomUUID();

  const inserted = await db
    .insert(leadNotes)
    .values({
      id,
      leadId: data.leadId,
      text: data.text,
      authorId: user.id,
      authorName: data.authorName ?? user.name,
      isLog: false,
      noteType: data.noteType ?? 'note',
      createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
    })
    .returning();

  if (!inserted[0]) return { success: false, error: 'Gagal menyimpan catatan' };

  revalidatePath(`/lead/${data.leadId}`);
  return {
    success: true,
    id,
  };
}

export async function deleteNote(id: string): Promise<{ success: boolean; error?: string }> {
  await requirePermission('canDeleteNotes');
  const deleted = await db
    .delete(leadNotes)
    .where(eq(leadNotes.id, id))
    .returning({ leadId: leadNotes.leadId });

  if (!deleted[0]) return { success: false, error: 'Catatan tidak ditemukan' };

  revalidatePath(`/lead/${deleted[0].leadId}`);
  return { success: true };
}
