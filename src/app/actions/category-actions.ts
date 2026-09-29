'use server';

import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { eq } from 'drizzle-orm';

const CATEGORIES_KEY = 'categories';

/**
 * Read the category registry.
 *
 * The registry lives in `app_settings.data` as a JSONB array. The legacy code
 * queried a table literally named `settings` with a `list` column, which was
 * never created by any migration - so this always threw and the UI silently
 * fell back to the hardcoded array below. The app looked like it worked; the
 * custom categories had simply never been stored.
 */
export async function getStoredCategories(): Promise<string[]> {
  await requireUser();
  const rows = await db
    .select({ data: appSettings.data })
    .from(appSettings)
    .where(eq(appSettings.id, CATEGORIES_KEY))
    .limit(1);

  const stored = rows[0]?.data as { list?: unknown } | undefined;
  if (Array.isArray(stored?.list)) {
    return (stored!.list as unknown[]).filter((c): c is string => typeof c === 'string');
  }
  return [];
}

export async function saveCategories(list: string[]): Promise<{ success: boolean; error?: string }> {
  await requireUser();
  const cleaned = Array.from(
    new Set(list.map((c) => c.trim()).filter((c) => c && c !== 'Tambah Baru')),
  ).sort((a, b) => a.localeCompare(b));

  await db
    .insert(appSettings)
    .values({ id: CATEGORIES_KEY, data: { list: cleaned }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { data: { list: cleaned }, updatedAt: new Date() },
    });

  revalidatePath('/leads');
  return { success: true };
}
