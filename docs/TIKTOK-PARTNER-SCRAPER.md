# Dokumentasi Scraping Leads Brand & WhatsApp (TikTok Shop Partner Center)

Dokumentasi ini mencatat arsitektur, struktur database penampungan (staging), trik unmasking, auto-scroll, dan mekanisme deteksi duplikasi pintar untuk integrasi data ke database CRM Sales TNT.

---

## 1. Alur Sistem End-to-End

```
[TikTok Shop Marketplace] 
       │ (1-Klik Bookmarklet)
       ▼
[Auto-Scroll & Unmask Sensor di Browser]
       │ (POST ke /api/scraped-leads dengan CORS)
       ▼
[Tabel Penampungan: scraped_leads di VPS]
       │ (Deteksi Kemiripan Nama / No WA dengan tabel leads utama)
       ▼
[Menu CRM: /scraped-leads]
       ├── [Opsi A: Tarik Sebagai Lead Baru] ──> Masuk ke tabel leads (Pipeline Sales)
       └── [Opsi B: Gabungkan Kontak] ─────────> Update nomor WA & tambah catatan di lead_notes (tanpa hapus data lama)
```

---

## 2. Aturan Bisnis & Logika Duplikasi

1. **Aturan Duplikasi Staging (Triple-Match):**
   - Data scraping yang masuk ke tabel `scraped_leads` hanya dianggap duplikat jika **Brand + WA + Email** ketiganya sama persis.
   - Jika nomor WA atau emailnya sama tetapi nama brand-nya berbeda (misal holding company yang punya banyak brand kosmetik), data **tetap disimpan dan tidak dibuang**.

2. **Deteksi Kemiripan dengan Leads Utama (Fuzzy Match):**
   - Di halaman `/scraped-leads`, sistem otomatis membandingkan setiap data baru dengan data di tabel `leads` utama:
     - Jika nomor WA sudah terdaftar pada lead yang ada, muncul badge: `⚠️ Mirip: "[Nama Lead]" (PIC: [Nama PIC])`.
     - Jika nama brand sama atau mirip (misal `Maybelline Indonesia` dengan `Maybelline`), sistem memberi sinyal kecocokan.

3. **Mekanisme Penggabungan Kontak (Multi-Contact Merge):**
   - User dapat memilih untuk **"Gabungkan Kontak"**:
     - Nomor kontak baru akan ditambahkan (misal `0812... / 0852...`).
     - Email diisi jika sebelumnya kosong.
     - Seluruh riwayat kontak tambahan dari TikTok Shop otomatis dicatat ke riwayat catatan (`lead_notes`).
     - **Tidak ada data kontak lama yang terhapus**.

---

## 3. Fitur Bookmarklet Cerdas (Auto-Scroll & Layar Bersih)

Bookmarklet yang dipasang di browser tim memiliki fitur:
1. **Target Count Prompt:** Saat diklik, muncul dialog: *"Berapa banyak leads yang ingin diambil?"* (default 50 atau 100).
2. **Cap Stempel (`data-tnt-scraped`):** Setiap kartu yang sudah diambil langsung distempel sehingga tidak akan pernah diklik ulang (0 detik).
3. **Auto-Scroll Otomatis:** Jika produk di layar sudah habis dan target belum tercapai, browser otomatis scroll ke bawah, menunggu produk baru termuat, lalu melanjutkan scraping.
4. **Pembersihan Popover 100%:** Setelah kontak diambil, popover langsung disembunyikan (`display: none !important`), sehingga layar TikTok tetap bersih dan tidak ada popover kontak yang melayang atau menumpuk.

---

## 4. Tabel Database Penampungan (`scraped_leads`)

Tabel didefinisikan di `drizzle/0007_scraped_leads.sql` dan `src/db/schema.ts`:

```sql
CREATE TABLE IF NOT EXISTS "scraped_leads" (
  "id" text PRIMARY KEY,
  "brand_name" text NOT NULL,
  "contact" text NOT NULL,
  "email" text,
  "product_name" text,
  "category" text,
  "lead_source" text DEFAULT 'TikTok Shop' NOT NULL,
  "status" "scraped_lead_status" DEFAULT 'pending' NOT NULL,
  "scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
  "scraped_by" text,
  "promoted_to_lead_id" text REFERENCES "leads"("id") ON DELETE SET NULL,
  "promoted_at" timestamp with time zone,
  "promoted_by" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
```

---

## 5. Lokasi Kode di Proyek

- **Schema & Enums:** `src/db/schema.ts`, `src/db/enums.ts`
- **Migrasi Database:** `drizzle/0007_scraped_leads.sql`
- **Server Actions:** `src/app/actions/scraped-lead-actions.ts`
- **API Endpoint:** `src/app/api/scraped-leads/route.ts`
- **UI & Bookmarklet:** `src/components/ScrapedLeadsClient.tsx`
- **Halaman Penampungan:** `src/app/(app)/scraped-leads/page.tsx`
- **Navigasi Sidebar:** `src/components/Sidebar.tsx`
