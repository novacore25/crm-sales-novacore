import { eq, ilike, notInArray } from 'drizzle-orm';

import { db } from '@/db';
import { users, type User } from '@/db/schema';
import { ROLE_PERMISSIONS, type PermissionSet } from '@/lib/permissions';

/**
 * The signed-in user as the app understands them.
 *
 * `id` is the internal TEXT primary key. It is deliberately *not* the Auth.js
 * provider account id, so that the two can be reconciled during migration
 * without touching foreign keys in lead_notes / funnel_history / tasks.
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: User['role'];
  permissions: PermissionSet;
}

/** Shape returned by `auth()` and passed down to client components. */
export interface UserProfile {
  uid: string;
  id: string;
  email: string;
  name: string;
  role: User['role'];
  permissions: PermissionSet;
}

function defaultPermissionsFor(role: User['role']): PermissionSet {
  if (role === 'lord') return ROLE_PERMISSIONS.lord;
  if (role === 'admin') return ROLE_PERMISSIONS.admin;
  return ROLE_PERMISSIONS.staff;
}

export function toProfile(user: User): UserProfile {
  return {
    uid: user.id,
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: defaultPermissionsFor(user.role),
  };
}

export function toSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: defaultPermissionsFor(user.role),
  };
}

/**
 * Look up an application user by the email Google authenticated.
 *
 * Returns null when the email is not in the users table. The caller decides
 * whether that means "reject" or "auto-register as pending" - the legacy app
 * auto-registered, and /admin/users then approved.
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const normalized = email.trim().toLowerCase();
  const rows = await db.select().from(users).where(ilike(users.email, normalized)).limit(1);
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Create a user in the `pending` role on first Google sign-in.
 *
 * Idempotent: if a row already exists for the email (possible when two browser
 * sessions register the same account concurrently) the existing row is
 * returned instead of throwing on the unique email constraint.
 */
export async function ensurePendingUser(email: string, name: string): Promise<User> {
  const existing = await findUserByEmail(email);
  if (existing) return existing;

  const inserted = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email,
      name: name || email.split('@')[0] || 'User Baru',
      role: 'pending',
    })
    .returning();

  if (inserted[0]) return inserted[0];

  // Lost a race against a concurrent registration; the other writer won.
  const fallback = await findUserByEmail(email);
  if (!fallback) {
    throw new Error(`Failed to register user ${email}`);
  }
  return fallback;
}

export async function countPendingUsers(): Promise<number> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'pending'));
  return rows.length;
}

export async function listUsers(): Promise<UserProfile[]> {
  const rows = await db.select().from(users);
  return rows.map(toProfile);
}

/** Staff and admins who can be assigned as PIC or targeted individually. */
export async function listActiveStaff(): Promise<UserProfile[]> {
  const rows = await db
    .select()
    .from(users)
    .where(notInArray(users.role, ['pending', 'lord']));
  return rows.map(toProfile);
}

export async function isLord(email: string): Promise<boolean> {
  const user = await findUserByEmail(email);
  return user?.role === 'lord';
}
