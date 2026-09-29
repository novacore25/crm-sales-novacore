'use server';

import { asc, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { auditLogs, users } from '@/db/schema';
import { requireLord, requireUser } from '@/lib/auth';
import { toProfile, type UserProfile } from '@/lib/auth-users';

/** All users, for the admin console and the PIC pickers. */
export async function getUsers(): Promise<UserProfile[]> {
  await requireUser();
  const rows = await db.select().from(users).orderBy(asc(users.name));
  return rows.map(toProfile);
}

export async function getPendingUserCount(): Promise<number> {
  await requireUser();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'pending'));
  return rows.length;
}

/**
 * Badge count for the sidebar. Never throws: this runs inside the root layout,
 * so a failure here must not take down every page.
 */
export async function countPendingUsersSafe(): Promise<number> {
  try {
    return await getPendingUserCount();
  } catch (error) {
    console.error('[nav] failed to count pending users', error);
    return 0;
  }
}

const roleSchema = z.enum(['lord', 'admin', 'staff', 'pending']);

/**
 * Change a user's role.
 *
 * Lord-only. The legacy version performed this from a client component with no
 * server check at all - it relied entirely on RLS, and no UPDATE policy on
 * `users` ever existed, so the guard was purely a hidden button.
 */
export async function setUserRole(
  userId: z.infer<typeof roleSchema>,
  role: z.infer<typeof roleSchema>,
): Promise<{ success: boolean; error?: string }> {
  const actor = await requireLord();
  const targetId = userId;

  if (targetId === actor.id && role !== 'lord') {
    return { success: false, error: 'Anda tidak dapat menurunkan role sendiri' };
  }

  const updated = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, targetId))
    .returning({ id: users.id });

  if (!updated[0]) return { success: false, error: 'User tidak ditemukan' };

  await db
    .insert(auditLogs)
    .values({
      id: crypto.randomUUID(),
      action: 'SET_ROLE',
      details: `Role ${targetId} diubah menjadi ${role} oleh ${actor.name}`,
      userId: actor.id,
      userName: actor.name,
      targetId,
    })
    .catch((error) => console.error('[audit] setUserRole', error));

  revalidatePath('/admin/users');
  revalidatePath('/');
  return { success: true };
}

export async function setUserName(
  userId: string,
  name: string,
): Promise<{ success: boolean; error?: string }> {
  const actor = await requireLord();
  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: 'Nama tidak boleh kosong' };

  const updated = await db
    .update(users)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id });

  if (!updated[0]) return { success: false, error: 'User tidak ditemukan' };

  revalidatePath('/admin/users');
  return { success: true };
}

/**
 * Distinct users who have ever touched a lead, used to populate the
 * "Filter PIC" dropdown. Derived from funnel_history because that is where
 * attribution actually lives.
 */
export async function getKnownPics(): Promise<string[]> {
  await requireUser();
  const rows = await db
    .selectDistinct({ name: sql<string>`by_user_name` })
    .from(sql`funnel_history`)
    .where(sql`by_user_name IS NOT NULL AND by_user_name <> 'System' AND by_user_name <> '-'`)
    .orderBy(asc(sql`by_user_name`));
  return rows.map((r) => r.name).filter(Boolean);
}
