'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { getCategories } from '@/app/actions/lead-actions';
import { getStoredCategories, saveCategories as persistCategories } from '@/app/actions/category-actions';
import { FALLBACK_CATEGORIES } from '@/types';

/**
 * Category registry for the lead form.
 *
 * The list is the union of three sources: the seeded defaults, whatever is
 * stored in `app_settings`, and every category already present on a lead. The
 * legacy version also wrote back to the settings table on every single mount,
 * which produced a spurious write per page load; the write now only happens
 * when a category is actually added.
 *
 * Distinct categories come from the server (`SELECT DISTINCT`), not from
 * scanning the whole leads table in the browser.
 */
export function useCategories() {
  const [categories, setCategories] = useState<string[]>(FALLBACK_CATEGORIES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [stored, fromLeads] = await Promise.all([getStoredCategories(), getCategories()]);

        const merged = Array.from(
          new Set([...FALLBACK_CATEGORIES, ...stored, ...fromLeads]),
        )
          .filter((c) => c && c !== 'Tambah Baru')
          .sort((a, b) => a.localeCompare(b));

        if (!cancelled) setCategories(merged);
      } catch (error) {
        console.error('[categories] load failed', error);
        if (!cancelled) setCategories(FALLBACK_CATEGORIES);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const addCategory = useCallback(async (newCat: string) => {
    const trimmed = newCat.trim();
    if (!trimmed) return;

    setCategories((current) => {
      if (current.includes(trimmed)) return current;
      const next = Array.from(new Set([...current, trimmed])).sort((a, b) => a.localeCompare(b));

      // Persist the union, not just the new value, so a failed write cannot
      // leave the stored list missing entries that are already on screen.
      persistCategories(next).catch((error) => {
        console.error('[categories] save failed', error);
        toast.error('Gagal menyimpan kategori baru');
      });

      return next;
    });
  }, []);

  return { categories, loading, addCategory };
}
