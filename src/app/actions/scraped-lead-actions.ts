'use server';

import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { funnelHistory, leadNotes, leads, scrapedLeads } from '@/db/schema';
import { requireUser } from '@/lib/auth';

export interface MatchedLeadInfo {
  id: string;
  brandName: string;
  contact: string;
  picName: string | null;
  matchReason: 'Nomor WA sama' | 'Nama Brand sama/mirip';
}

export interface ScrapedLeadRow {
  id: string;
  brandName: string;
  contact: string;
  email: string | null;
  productName: string | null;
  category: string | null;
  leadSource: string;
  status: 'pending' | 'promoted' | 'ignored';
  scrapedAt: string;
  scrapedBy: string | null;
  promotedToLeadId: string | null;
  promotedAt: string | null;
  promotedBy: string | null;
  notes: string | null;
  matchedLead?: MatchedLeadInfo | null;
}

export interface ScrapedLeadInputItem {
  brand: string;
  phone: string;
  email?: string | null;
  product?: string | null;
  category?: string | null;
}

/**
 * Mengambil daftar data scraped leads dari penampungan dan mencocokkan dengan leads utama yang sudah ada
 */
export async function getScrapedLeads(options?: {
  status?: 'all' | 'pending' | 'promoted' | 'ignored';
  search?: string;
  limit?: number;
}): Promise<ScrapedLeadRow[]> {
  await requireUser();

  const statusFilter = options?.status && options.status !== 'all' ? options.status : null;
  const search = options?.search?.trim() ? `%${options.search.trim()}%` : null;
  const limit = options?.limit ?? 500;

  const conditions = [];

  if (statusFilter) {
    conditions.push(eq(scrapedLeads.status, statusFilter));
  }

  if (search) {
    conditions.push(
      or(
        ilike(scrapedLeads.brandName, search),
        ilike(scrapedLeads.contact, search),
        ilike(scrapedLeads.email, search),
        ilike(scrapedLeads.productName, search),
      ),
    );
  }

  // Bersihkan otomatis baris sampah hasil unmasking prematur (tanpa nomor WA dan email terpotong/bintang)
  try {
    await db
      .delete(scrapedLeads)
      .where(
        and(
          eq(scrapedLeads.status, 'pending'),
          or(isNull(scrapedLeads.contact), eq(scrapedLeads.contact, ''), eq(scrapedLeads.contact, '-')),
          or(
            isNull(scrapedLeads.email),
            sql`${scrapedLeads.email} ~* '^[a-z0-9]{1,2}@'`,
            sql`${scrapedLeads.email} LIKE '%*%'`,
          ),
        ),
      );
  } catch (err) {
    console.error('Auto clean junk leads error:', err);
  }

  // 1. Ambil data penampungan
  const rows = await db
    .select()
    .from(scrapedLeads)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(scrapedLeads.scrapedAt))
    .limit(limit);

  // 2. Ambil snapshot leads utama untuk mencocokkan kemiripan brand / kontak
  const mainLeads = await db
    .select({
      id: leads.id,
      brandName: leads.brandName,
      contact: leads.contact,
      picName: leads.picName,
    })
    .from(leads)
    .where(eq(leads.isDeleted, false));

  return rows.map((r) => {
    // Cari apakah ada kecocokan di leads utama
    let matched: MatchedLeadInfo | null = null;
    const cleanPhone = r.contact.replace(/[^\d]/g, '');
    const cleanBrand = r.brandName.trim().toLowerCase();

    for (const ml of mainLeads) {
      const mlPhone = (ml.contact || '').replace(/[^\d]/g, '');
      const mlBrand = (ml.brandName || '').trim().toLowerCase();

      // Cocok kontak (jika ada nomor kontak)
      if (cleanPhone && cleanPhone.length >= 8 && (mlPhone.includes(cleanPhone) || cleanPhone.includes(mlPhone))) {
        matched = {
          id: ml.id,
          brandName: ml.brandName,
          contact: ml.contact,
          picName: ml.picName,
          matchReason: 'Nomor WA sama',
        };
        break;
      }

      // Cocok nama brand sama atau mirip
      if (cleanBrand.length >= 3 && (mlBrand === cleanBrand || mlBrand.includes(cleanBrand) || cleanBrand.includes(mlBrand))) {
        matched = {
          id: ml.id,
          brandName: ml.brandName,
          contact: ml.contact,
          picName: ml.picName,
          matchReason: 'Nama Brand sama/mirip',
        };
        break;
      }
    }

    return {
      id: r.id,
      brandName: r.brandName,
      contact: r.contact,
      email: r.email,
      productName: r.productName,
      category: r.category,
      leadSource: r.leadSource,
      status: r.status,
      scrapedAt: r.scrapedAt.toISOString(),
      scrapedBy: r.scrapedBy,
      promotedToLeadId: r.promotedToLeadId,
      promotedAt: r.promotedAt ? r.promotedAt.toISOString() : null,
      promotedBy: r.promotedBy,
      notes: r.notes,
      matchedLead: matched,
    };
  });
}

/**
 * Menyimpan data hasil scraping dari browser/bookmarklet ke tabel penampungan (scraped_leads).
 * Aturan Duplikasi:
 * Data hanya duplikat jika Brand Name + Contact (WA) + Email KETIGANYA sama persis.
 * Jika salah satu beda (misal nomor WA holding sama tapi nama brand beda), tetap disimpan.
 */
export async function saveScrapedBatch(
  items: ScrapedLeadInputItem[],
  scrapedBy?: string,
): Promise<{ total: number; inserted: number; skipped: number; error?: string }> {
  if (!items || !items.length) {
    return { total: 0, inserted: 0, skipped: 0 };
  }

  try {
    let insertedCount = 0;
    let skippedCount = 0;
    const batchSeen = new Set<string>();

    for (const raw of items) {
      const brand = (raw.brand || '').trim();
      const phone = (raw.phone || '').trim().replace(/[^\d]/g, '');
      const email = raw.email && raw.email !== '-' ? raw.email.trim().toLowerCase() : '';
      const product = (raw.product || '').trim();
      const category = (raw.category || '').trim() || 'Beauty & Personal Care';

      // Minimal harus punya nama brand dan nomor kontak/email
      if (!brand || (!phone && !email)) {
        skippedCount++;
        continue;
      }

      // Validasi ketat anti-data sampah: tolak jika ada tanda bintang '*'
      if (phone.includes('*') || email.includes('*')) {
        skippedCount++;
        continue;
      }

      // Tolak jika kontak kosong dan email terpotong (misal "i@domain.com")
      if (!phone && email) {
        const localPart = email.split('@')[0] || '';
        if (localPart.length <= 2) {
          skippedCount++;
          continue;
        }
      }

      // Kunci unik anti-duplikat dalam 1 batch
      const dedupKey = `${brand.toLowerCase()}|${phone}|${email}`;
      if (batchSeen.has(dedupKey)) {
        skippedCount++;
        continue;
      }
      batchSeen.add(dedupKey);

      // Cek apakah di database sudah ada baris pending untuk brand yang sama
      const existingBrand = await db
        .select()
        .from(scrapedLeads)
        .where(
          and(
            sql`LOWER(${scrapedLeads.brandName}) = ${brand.toLowerCase()}`,
            eq(scrapedLeads.status, 'pending'),
          ),
        )
        .limit(1);

      if (existingBrand.length > 0) {
        const ex = existingBrand[0];
        // Jika baris lama di DB belum punya kontak WA lengkap tapi data baru punya nomor WA lengkap:
        // Update baris lama tersebut agar terisi nomor WA & email lengkap (tidak membuat baris dobel)
        if ((!ex.contact || ex.contact === '-') && phone) {
          await db
            .update(scrapedLeads)
            .set({
              contact: phone,
              email: email || ex.email,
              productName: product || ex.productName,
              category: category || ex.category,
              updatedAt: new Date(),
            })
            .where(eq(scrapedLeads.id, ex.id));
          insertedCount++;
          continue;
        }
        // Jika data lama sudah lengkap, lewati agar tidak dobel
        skippedCount++;
        continue;
      }

      // Simpan ke tabel penampungan
      await db.insert(scrapedLeads).values({
        id: crypto.randomUUID(),
        brandName: brand,
        contact: phone,
        email: email || null,
        productName: product || null,
        category: category,
        leadSource: 'TikTok Shop',
        status: 'pending',
        scrapedBy: scrapedBy || 'Bookmarklet',
      });

      insertedCount++;
    }

    revalidatePath('/scraped-leads');

    return {
      total: items.length,
      inserted: insertedCount,
      skipped: skippedCount,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Gagal menyimpan batch';
    return { total: items.length, inserted: 0, skipped: items.length, error: msg };
  }
}

const promoteSchema = z.object({
  scrapedLeadIds: z.array(z.string().min(1)),
  picName: z.string().min(1, 'Pilih PIC yang bertugas'),
  category: z.string().min(1, 'Pilih Kategori'),
  productOffered: z.array(z.string()).optional(),
});

/**
 * Menarik data dari penampungan (scraped_leads) ke tabel leads utama CRM.
 * Data di scraped_leads berubah status menjadi 'promoted' dan terhubung ke leadId baru.
 */
export async function promoteScrapedLeadsToMain(
  input: z.infer<typeof promoteSchema>,
): Promise<{ success: boolean; promotedCount: number; error?: string }> {
  const user = await requireUser();

  const parsed = promoteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, promotedCount: 0, error: parsed.error.issues[0]?.message ?? 'Data tidak valid' };
  }

  const { scrapedLeadIds, picName, category, productOffered } = parsed.data;
  if (!scrapedLeadIds.length) {
    return { success: false, promotedCount: 0, error: 'Tidak ada leads yang dipilih' };
  }

  // Ambil record yang mau dipromosikan
  const records = await db
    .select()
    .from(scrapedLeads)
    .where(inArray(scrapedLeads.id, scrapedLeadIds));

  if (!records.length) {
    return { success: false, promotedCount: 0, error: 'Data tidak ditemukan di penampungan' };
  }

  const now = new Date();
  const dateInputStr = now.toISOString().slice(0, 10);
  let count = 0;

  // Jalankan dalam transaksi Drizzle agar jika satu gagal, rollback aman
  await db.transaction(async (tx) => {
    for (const record of records) {
      if (record.status === 'promoted') continue; // sudah pernah ditarik sebelumnya

      const newLeadId = crypto.randomUUID();

      // 1. Simpan ke tabel leads utama
      await tx.insert(leads).values({
        id: newLeadId,
        dateInput: dateInputStr,
        category: record.category || category || 'Beauty & Personal Care',
        brandName: record.brandName,
        contact: record.contact,
        leadSource: record.leadSource || 'TikTok Shop',
        email: record.email,
        status: 'Leads',
        interestLevel: '-',
        productOffered: productOffered || ['TNT'],
        picName: picName,
        actionPlan: record.productName ? `Produk: ${record.productName}` : null,
        dealValue: '0',
      });

      // 2. Beri catatan funnel awal agar pipeline berjalan
      await tx.insert(funnelHistory).values({
        id: crypto.randomUUID(),
        leadId: newLeadId,
        stage: 'Leads',
        dateOccurred: now,
        byUserName: user.name,
        byUserId: user.id,
        note: `Ditarik dari Penampungan Scraped Leads oleh ${user.name}`,
      });

      // 3. Update status di tabel penampungan menjadi 'promoted'
      await tx
        .update(scrapedLeads)
        .set({
          status: 'promoted',
          promotedToLeadId: newLeadId,
          promotedAt: now,
          promotedBy: user.name,
          updatedAt: now,
        })
        .where(eq(scrapedLeads.id, record.id));

      count++;
    }
  });

  revalidatePath('/scraped-leads');
  revalidatePath('/leads');
  revalidatePath('/');

  return { success: true, promotedCount: count };
}

/**
 * Mengubah status data di penampungan menjadi 'ignored' (diabaikan)
 */
export async function ignoreScrapedLeads(
  ids: string[],
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();
  if (!ids.length) return { success: true };

  await db
    .update(scrapedLeads)
    .set({
      status: 'ignored',
      updatedAt: new Date(),
      notes: `Diabaikan oleh ${user.name}`,
    })
    .where(inArray(scrapedLeads.id, ids));

  revalidatePath('/scraped-leads');
  return { success: true };
}

/**
 * Menghapus data penampungan secara permanen
 */
export async function deleteScrapedLeads(
  ids: string[],
): Promise<{ success: boolean; error?: string }> {
  await requireUser();
  if (!ids.length) return { success: true };

  await db.delete(scrapedLeads).where(inArray(scrapedLeads.id, ids));

  revalidatePath('/scraped-leads');
  return { success: true };
}

/**
 * Menggabungkan data kontak scraped lead ke lead utama yang sudah ada
 * - Menambahkan nomor kontak jika belum ada (tanpa menghapus nomor lama)
 * - Menambahkan email jika lead target belum punya email
 * - Menambahkan catatan di leadNotes (riwayat kontak tambahan dari TikTok)
 * - Menandai scraped_lead sebagai 'promoted'
 */
export async function mergeScrapedLeadIntoExisting(input: {
  scrapedLeadId: string;
  targetLeadId: string;
}): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();
  const { scrapedLeadId, targetLeadId } = input;

  const scraped = await db
    .select()
    .from(scrapedLeads)
    .where(eq(scrapedLeads.id, scrapedLeadId))
    .limit(1);

  if (!scraped.length) {
    return { success: false, error: 'Data penampungan tidak ditemukan' };
  }

  const target = await db
    .select()
    .from(leads)
    .where(eq(leads.id, targetLeadId))
    .limit(1);

  if (!target.length) {
    return { success: false, error: 'Lead target tidak ditemukan' };
  }

  const s = scraped[0];
  const t = target[0];
  const now = new Date();

  await db.transaction(async (tx) => {
    // 1. Gabungkan nomor kontak jika berbeda
    let updatedContact = t.contact;
    if (s.contact && !t.contact.includes(s.contact)) {
      updatedContact = `${t.contact} / ${s.contact}`;
    }

    // 2. Isi email jika sebelumnya kosong
    let updatedEmail = t.email;
    if (!t.email && s.email) {
      updatedEmail = s.email;
    }

    await tx
      .update(leads)
      .set({
        contact: updatedContact,
        email: updatedEmail,
        updatedAt: now,
      })
      .where(eq(leads.id, targetLeadId));

    // 3. Catat di leadNotes sebagai riwayat kontak tambahan
    await tx.insert(leadNotes).values({
      id: crypto.randomUUID(),
      leadId: targetLeadId,
      text: `[Kontak Tambahan dari TikTok Shop]\nBrand: ${s.brandName}\nWA: +${s.contact}\nEmail: ${s.email || '-'}\nProduk: ${s.productName || '-'}`,
      authorId: user.id,
      authorName: user.name,
      isLog: true,
      noteType: 'contact_update',
    });

    // 4. Tandai scraped_leads sebagai promoted
    await tx
      .update(scrapedLeads)
      .set({
        status: 'promoted',
        promotedToLeadId: targetLeadId,
        promotedAt: now,
        promotedBy: user.name,
        notes: `Digabungkan ke ${t.brandName} (${t.picName})`,
        updatedAt: now,
      })
      .where(eq(scrapedLeads.id, scrapedLeadId));
  });

  revalidatePath('/scraped-leads');
  revalidatePath('/leads');
  revalidatePath(`/lead/${targetLeadId}`);
  return { success: true };
}

