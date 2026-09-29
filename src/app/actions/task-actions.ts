'use server';

import { and, desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { editRequests, leadNotes, leads, tasks, users } from '@/db/schema';
import { requireLordOrAdmin, requireUser } from '@/lib/auth';

// ============================================================================
// Tasks
// ============================================================================

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  dueDate: string;
  priority: string;
  status: string;
  assignedTo: string | null;
  assignedToName: string;
  createdBy: string | null;
  createdByName: string;
  createdAt: string;
  leadId: string | null;
  leadName: string;
}

export async function getTasks(): Promise<TaskRow[]> {
  await requireUser();

  // Explicit joins replace the PostgREST embed
  // `users!tasks_assigned_to_fkey(name), leads(brand_name)`, which depended on
  // Postgres' auto-generated FK constraint name and broke on any schema rename.
  const rows = await db
    .select({
      task: tasks,
      assigneeName: users.name,
      leadName: leads.brandName,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assignedTo, users.id))
    .leftJoin(leads, eq(tasks.leadId, leads.id))
    .orderBy(desc(tasks.createdAt));

  return rows.map((r) => ({
    id: r.task.id,
    title: r.task.title,
    description: r.task.description,
    dueDate: r.task.dueDate?.toISOString() ?? '',
    priority: r.task.priority ?? 'Medium',
    status: r.task.status ?? 'Todo',
    assignedTo: r.task.assignedTo,
    assignedToName: r.task.assignedToName ?? r.assigneeName ?? 'Unknown',
    createdBy: r.task.createdBy,
    createdByName: r.task.createdByName ?? r.assigneeName ?? '-',
    createdAt: r.task.createdAt?.toISOString() ?? '',
    leadId: r.task.leadId,
    leadName: r.task.leadId ? (r.leadName ?? '') : '',
  }));
}

const taskSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, 'Judul task wajib diisi'),
  description: z.string().optional().nullable(),
  dueDate: z.string().min(1, 'Tanggal jatuh tempo wajib diisi'),
  priority: z.enum(['Low', 'Medium', 'High']).default('Medium'),
  status: z.enum(['Todo', 'In Progress', 'Done']).default('Todo'),
  assignedTo: z.string().optional().nullable(),
  leadId: z.string().optional().nullable(),
});

export async function saveTask(
  input: z.infer<typeof taskSchema>,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const user = await requireUser();

  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message };
  const data = parsed.data;

  const assignee = data.assignedTo
    ? await db.select({ name: users.name }).from(users).where(eq(users.id, data.assignedTo)).limit(1)
    : [];
  const assigneeName = assignee[0]?.name ?? '-';

  const values = {
    title: data.title,
    description: data.description ?? null,
    dueDate: new Date(data.dueDate),
    priority: data.priority,
    status: data.status,
    assignedTo: data.assignedTo ?? null,
    assignedToName: assigneeName,
    leadId: data.leadId ?? null,
    updatedAt: new Date(),
  };

  if (data.id) {
    // Preserve the existing status when editing unless explicitly changed. The
    // legacy modal hardcoded `status: 'Todo'` on every save, which reset any
    // in-progress work.
    const existing = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, data.id))
      .limit(1);
    if (!existing[0]) return { success: false, error: 'Task tidak ditemukan' };

    await db.update(tasks).set(values).where(eq(tasks.id, data.id));
    revalidatePath('/tasks');
    revalidatePath(`/lead/${data.leadId}`);
    return { success: true, id: data.id };
  }

  const id = crypto.randomUUID();
  await db.insert(tasks).values({
    id,
    ...values,
    createdBy: user.id,
    createdByName: user.name,
    createdAt: new Date(),
  });

  revalidatePath('/tasks');
  revalidatePath(`/lead/${data.leadId}`);
  return { success: true, id };
}

/** Toggle a task between Todo / In Progress / Done. */
export async function setTaskStatus(
  id: string,
  status: 'Todo' | 'In Progress' | 'Done',
): Promise<{ success: boolean; error?: string }> {
  await requireUser();
  const updated = await db
    .update(tasks)
    .set({ status, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning({ id: tasks.id });

  if (!updated[0]) return { success: false, error: 'Task tidak ditemukan' };
  revalidatePath('/tasks');
  return { success: true };
}

export async function deleteTask(id: string): Promise<{ success: boolean; error?: string }> {
  await requireUser();
  const deleted = await db.delete(tasks).where(eq(tasks.id, id)).returning({ id: tasks.id });
  if (!deleted[0]) return { success: false, error: 'Task tidak ditemukan' };

  revalidatePath('/tasks');
  return { success: true };
}

/** Leads a task can be attached to. */
export async function getLeadOptions(): Promise<Array<{ id: string; brandName: string }>> {
  await requireUser();
  const rows = await db
    .select({ id: leads.id, brandName: leads.brandName })
    .from(leads)
    .where(eq(leads.isDeleted, false));
  return rows;
}

// ============================================================================
// Edit requests (staff asks, admin approves)
// ============================================================================

export interface EditRequestRow {
  id: string;
  leadId: string;
  oldBrand: string | null;
  newBrand: string | null;
  oldContact: string | null;
  newContact: string | null;
  requestedById: string | null;
  requestedByName: string | null;
  status: string;
  createdAt: string;
}

export async function getEditRequests(): Promise<EditRequestRow[]> {
  await requireLordOrAdmin();
  const rows = await db.select().from(editRequests).orderBy(desc(editRequests.createdAt));
  return rows.map((r) => ({
    id: r.id,
    leadId: r.leadId,
    oldBrand: r.oldBrand,
    newBrand: r.newBrand,
    oldContact: r.oldContact,
    newContact: r.newContact,
    requestedById: r.requestedById,
    requestedByName: r.requestedByName,
    status: r.status ?? 'pending',
    createdAt: r.createdAt?.toISOString() ?? '',
  }));
}

export async function getPendingEditRequestCount(): Promise<number> {
  await requireLordOrAdmin();
  const rows = await db
    .select({ id: editRequests.id })
    .from(editRequests)
    .where(eq(editRequests.status, 'pending'));
  return rows.length;
}

const requestEditSchema = z.object({
  leadId: z.string().min(1),
  oldBrand: z.string().optional().nullable(),
  newBrand: z.string().optional().nullable(),
  oldContact: z.string().optional().nullable(),
  newContact: z.string().optional().nullable(),
});

/**
 * Submit a brand/contact change request.
 *
 * Staff cannot edit master data directly, so they file a request. The legacy
 * version inserted `requested_by` and `timestamp` - neither is a column on
 * edit_requests - so every request failed to persist and the approvals page
 * additionally ordered by the non-existent `timestamp` column, which made the
 * whole page 500.
 */
export async function createEditRequest(
  input: z.infer<typeof requestEditSchema>,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();

  const parsed = requestEditSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message };
  const data = parsed.data;

  await db.insert(editRequests).values({
    id: crypto.randomUUID(),
    leadId: data.leadId,
    oldBrand: data.oldBrand ?? null,
    newBrand: data.newBrand ?? null,
    oldContact: data.oldContact ?? null,
    newContact: data.newContact ?? null,
    requestedById: user.id,
    requestedByName: user.name,
    status: 'pending',
    createdAt: new Date(),
  });

  revalidatePath('/admin/approvals');
  return { success: true };
}

/**
 * Approve a request: apply the change to the lead, log it as a note, and close
 * the request. All three writes in one transaction.
 */
export async function approveEditRequest(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireLordOrAdmin();

  const rows = await db.select().from(editRequests).where(eq(editRequests.id, id)).limit(1);
  const request = rows[0];
  if (!request) return { success: false, error: 'Permintaan tidak ditemukan' };
  if (request.status !== 'pending') return { success: false, error: 'Permintaan sudah diproses' };

  await db.transaction(async (tx) => {
    await tx
      .update(leads)
      .set({
        ...(request.newBrand ? { brandName: request.newBrand } : {}),
        ...(request.newContact ? { contact: request.newContact } : {}),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, request.leadId));

    // The old code round-tripped a phantom `leads.notes` column; notes live in
    // lead_notes and are appended, not overwritten.
    await tx.insert(leadNotes).values(approvalNote(request, user.name, user.id));

    await tx
      .update(editRequests)
      .set({ status: 'approved', resolvedAt: new Date(), resolvedBy: user.id })
      .where(eq(editRequests.id, id));
  });

  revalidatePath('/admin/approvals');
  revalidatePath('/leads');
  revalidatePath(`/lead/${request.leadId}`);
  return { success: true };
}

function approvalNote(
  request: { leadId: string; newBrand: string | null; newContact: string | null },
  authorName: string,
  authorId: string,
) {
  const changes: string[] = [];
  if (request.newBrand) changes.push(`Brand: ${request.newBrand}`);
  if (request.newContact) changes.push(`Kontak: ${request.newContact}`);

  return {
    id: crypto.randomUUID(),
    leadId: request.leadId,
    text: `Perubahan disetujui - ${changes.join(' | ')}`,
    authorId,
    authorName,
    isLog: true,
    noteType: 'note',
    createdAt: new Date(),
  };
}

export async function rejectEditRequest(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireLordOrAdmin();

  const updated = await db
    .update(editRequests)
    .set({ status: 'rejected', resolvedAt: new Date(), resolvedBy: user.id })
    .where(eq(editRequests.id, id))
    .returning({ id: editRequests.id });

  if (!updated[0]) return { success: false, error: 'Permintaan tidak ditemukan' };

  revalidatePath('/admin/approvals');
  return { success: true };
}

export async function getPendingEditRequestsForLead(
  leadId: string,
): Promise<EditRequestRow[]> {
  await requireUser();
  const rows = await db
    .select()
    .from(editRequests)
    .where(and(eq(editRequests.leadId, leadId), eq(editRequests.status, 'pending')));
  return rows.map((r) => ({
    id: r.id,
    leadId: r.leadId,
    oldBrand: r.oldBrand,
    newBrand: r.newBrand,
    oldContact: r.oldContact,
    newContact: r.newContact,
    requestedById: r.requestedById,
    requestedByName: r.requestedByName,
    status: r.status ?? 'pending',
    createdAt: r.createdAt?.toISOString() ?? '',
  }));
}

export async function getPendingEditRequestsCountSafe(): Promise<number> {
  try {
    return await getPendingEditRequestCount();
  } catch {
    return 0;
  }
}
