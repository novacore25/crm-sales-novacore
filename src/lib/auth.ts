import { cache } from 'react';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { can, isLord, isLordOrAdmin, permissionsForRole, type PermissionSet } from './permissions';
import type { UserProfile } from './auth-users';
import { toProfile } from './auth-users';

/**
 * Server-side auth helpers.
 *
 * Every server action calls one of these. They are the replacement for Supabase
 * RLS: because the app now holds a direct Postgres connection, there is no
 * policy engine sitting between the query and the data, so the check has to
 * happen here, against a freshly-read role, never against client input.
 */

/**
 * The signed-in user's database row, or null.
 *
 * `cache()` dedupes the lookup within a single render pass, so a layout plus
 * three nested pages that each need the user cost one query, not four.
 */
export const getCurrentUser = cache(async () => {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
});

/**
 * Require any authenticated, non-pending user.
 *
 * `pending` users are signed in but must not reach application data. The legacy
 * middleware allowed them through and relied on each page to bail out; this
 * centralises that.
 */
export async function requireUser(): Promise<UserProfile> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role === 'pending') redirect('/pending');
  return toProfile(user);
}

export async function requireRole(roles: Array<UserProfile['role']>): Promise<UserProfile> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect('/');
  return user;
}

/** Guard for destructive or privileged actions. Throws rather than redirecting. */
export async function requirePermission(permission: keyof PermissionSet): Promise<UserProfile> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized: not signed in');
  if (user.role === 'pending') throw new Error('Unauthorized: account pending approval');
  if (!can(user.role, permission)) {
    throw new Error(`Unauthorized: missing permission ${permission}`);
  }
  return toProfile(user);
}

export async function requireLord(): Promise<UserProfile> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized: not signed in');
  if (!isLord(user.role)) throw new Error('Unauthorized: lord only');
  return toProfile(user);
}

export async function requireLordOrAdmin(): Promise<UserProfile> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized: not signed in');
  if (!isLordOrAdmin(user.role)) throw new Error('Unauthorized: admin only');
  return toProfile(user);
}

export { isLord, isLordOrAdmin, permissionsForRole };
export type { UserProfile };
