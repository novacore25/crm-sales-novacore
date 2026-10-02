'use server';

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { individualTargets, oiTargets, users } from '@/db/schema';
import { requirePermission, requireUser } from '@/lib/auth';

const monthYearSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Format bulan harus YYYY-MM');

// ============================================================================
// Global targets
// ============================================================================

/*
 * `global_targets` is no longer read or written by the application.
 *
 * It held one revenue figure per month with no product breakdown, which cannot
 * express a target that is split across TNT, MCN and HYPE, and it also held chat
 * and meeting counts that nobody set at company level. The company's revenue
 * target is the sum of the per-product milestone targets in `oi_targets`, which
 * is what the office actually maintains, so the stored global figure was a second
 * answer to a question that already had one.
 *
 * The table and its rows are deliberately left in place. Dropping them is a
 * destructive migration for no gain, and if the figure is ever wanted again the
 * history is still there.
 */

/**
 * Per-product milestone targets for every month, which is what the company
 * revenue target is now made of.
 *
 * Returned ungrouped so the caller can show the breakdown as well as the total.
 * A total on its own would be a number nobody could trace back to a decision.
 */
export async function getMilestoneTargets(): Promise<OITargetRow[]> {
  await requireUser();
  const rows = await db
    .select()
    .from(oiTargets)
    .orderBy(sql`${oiTargets.monthYear} desc`, sql`${oiTargets.product}`);
  return rows.map((t) => ({
    id: t.id,
    monthYear: t.monthYear,
    product: t.product,
    targetValue: Number(t.targetValue ?? 0),
    updatedAt: t.updatedAt?.toISOString() ?? '',
  }));
}

// ============================================================================
// Individual targets
// ============================================================================

export interface IndividualTargetRow {
  id: string;
  userId: string;
  userName: string;
  monthYear: string;
  targetChat: number;
  targetMeeting: number;
  targetRevenue: number;
  updatedBy: string | null;
  updatedAt: string;
}

/**
 * Per-staff monthly targets.
 *
 * These belong in `individual_targets`. The legacy admin screen wrote them into
 * `oi_targets` - the per-product OI forecast table - with six non-existent
 * columns and a missing NOT NULL `product`, so the individual-target feature
 * never persisted anything.
 */
export async function getIndividualTargets(): Promise<IndividualTargetRow[]> {
  await requireUser();
  const rows = await db
    .select({
      target: individualTargets,
      userName: users.name,
    })
    .from(individualTargets)
    .leftJoin(users, eq(individualTargets.userId, users.id))
    .orderBy(sql`${users.name}`);

  return rows.map((r) => ({
    id: r.target.id,
    userId: r.target.userId,
    userName: r.target.userName ?? r.userName ?? '-',
    monthYear: r.target.monthYear,
    targetChat: r.target.targetChat ?? 0,
    targetMeeting: r.target.targetMeeting ?? 0,
    targetRevenue: Number(r.target.targetRevenue ?? 0),
    updatedBy: r.target.updatedBy,
    updatedAt: r.target.updatedAt?.toISOString() ?? '',
  }));
}

export async function setIndividualTarget(input: {
  userId: string;
  monthYear: string;
  targetChat: number;
  targetMeeting: number;
  targetRevenue: number;
}): Promise<{ success: boolean; error?: string }> {
  const user = await requirePermission('canSetTargets');

  const parsed = monthYearSchema.safeParse(input.monthYear);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  const targetUser = await db.select({ name: users.name }).from(users).where(eq(users.id, input.userId)).limit(1);
  const displayName = targetUser[0]?.name ?? '-';

  await db
    .insert(individualTargets)
    .values({
      id: `${input.monthYear}_${input.userId}`,
      userId: input.userId,
      userName: displayName,
      monthYear: input.monthYear,
      targetChat: Math.trunc(input.targetChat) || 0,
      targetMeeting: Math.trunc(input.targetMeeting) || 0,
      targetRevenue: String(input.targetRevenue || 0),
      updatedBy: user.id,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [individualTargets.userId, individualTargets.monthYear],
      set: {
        targetChat: Math.trunc(input.targetChat) || 0,
        targetMeeting: Math.trunc(input.targetMeeting) || 0,
        targetRevenue: String(input.targetRevenue || 0),
        userName: displayName,
        updatedBy: user.id,
        updatedAt: new Date(),
      },
    });

  revalidatePath('/admin/targets');
  revalidatePath('/');
  return { success: true };
}

// ============================================================================
// OI targets (per product, per month)
// ============================================================================

export interface OITargetRow {
  id: string;
  monthYear: string;
  product: string;
  targetValue: number;
  updatedAt: string;
}

export async function getOITargets(): Promise<OITargetRow[]> {
  await requireUser();
  const rows = await db.select().from(oiTargets);
  return rows.map((t) => ({
    id: t.id,
    monthYear: t.monthYear,
    product: t.product,
    targetValue: Number(t.targetValue ?? 0),
    updatedAt: t.updatedAt?.toISOString() ?? '',
  }));
}

export async function setOITarget(input: {
  monthYear: string;
  product: string;
  targetValue: number;
}): Promise<{ success: boolean; error?: string }> {
  await requirePermission('canSetTargets');

  const parsed = monthYearSchema.safeParse(input.monthYear);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  await db
    .insert(oiTargets)
    .values({
      id: `${input.product}_${input.monthYear}`,
      monthYear: input.monthYear,
      product: input.product,
      targetValue: String(input.targetValue || 0),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [oiTargets.monthYear, oiTargets.product],
      set: {
        targetValue: String(input.targetValue || 0),
        updatedAt: new Date(),
      },
    });

  revalidatePath('/oi_forecast');
  return { success: true };
}
