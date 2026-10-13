# Dokumentasi Scraping Leads Brand & WhatsApp (TikTok Shop Partner Center)

Dokumentasi ini mencatat arsitektur, struktur database penampungan (staging), trik unmasking, auto-scroll, dan mekanisme deteksi duplikasi pintar untuk integrasi data ke database CRM Sales TNT.

---

## 1. Alur Sistem End-to-End

```
[TikTok Shop Marketplace di Browser]
       │
       ▼ (1. Validasi Kategori Level 1 via Cascader Tooltip)
[Pilih Kategori Produk] ──> Jika belum pilih: Muncul peringatan & berhenti
       │
       ▼ (2. Input Target Leads & Floating Control Box)
[User isi Target: misal 100 leads]
       │
       ▼ (3. Loop Kartu Produk .rounded-4)
[Cek Nama Brand] ──> Jika Brand sudah pernah diambil kontaknya di sesi ini:
       │             SKIP KARTU SEKETIKA (Hemat waktu 5x, anti dobel brand)
       ▼
[4. Klik Ikon Chat di Kartu] ──> Tunggu 250ms popover .arco-popover-inner-content muncul
       │
       ▼ (5. Deteksi & Klik Ikon Mata Sensor - Eye Unmasking)
[Klik Ikon Mata di Header 'Contact Seller'] ──> Dispatch mousedown, mouseup, click
       │                                        ke tombol & SVG sekaligus
       ▼
[6. Polling Adaptif & Syarat Mutlak Bebas Bintang '*']
  - Cek tiap 45ms (maksimal 35 putaran = 1.75 detik).
  - Jika putaran ke-8 masih bertanda bintang: Klik ulang ikon mata otomatis.
  - Begitu tanda bintang '*' hilang: Langsung ekstrak tanpa menunggu timeout!
  - JIKA MASIH ADA BINTANG '*': REJECT! Dilarang simpan data setengah matang.
       │
       ▼ (7. Real-Time Auto Backup)
  - Simpan tiap kartu ke localStorage ('tnt_scraped_backup').
  - Salin tiap 5 kartu ke Clipboard komputer.
       │
       ▼ (8. Auto-Scroll & Deteksi Kartu Baru)
  - Jika kartu di layar habis: scroll window & container ke bawah.
  - Toleransi hingga 8 idle scrolls sebelum berhenti.
       │
       ▼ (9. Bypass CSP TikTok via postMessage / Clipboard)
[Klik Tombol 'Buka & Simpan ke CRM']
       │
       ├── Jalur Utama: window.open('/scraped-leads#incoming') + postMessage
       └── Jalur Cadangan: Tombol 'Tempel Leads (Clipboard)' di UI CRM
       │
       ▼ (10. Server Action: saveScrapedBatch)
[Tabel Penampungan: scraped_leads di Database VPS]
  - Validasi ketat backend: Tolak nomor/email berbintang atau email terpotong.
  - Auto-Merge Pending Brand: Jika brand sama sudah ada di DB tanpa WA,
    dan data baru punya WA lengkap, UPDATE baris lama agar lengkap tanpa baris dobel.
  - Deteksi kemiripan otomatis dengan tabel leads utama.
```

---

## 2. Aturan Bisnis & Logika Duplikasi

1. **Aturan Duplikasi Staging (Triple-Match):**
   - Data scraping yang masuk ke tabel `scraped_leads` hanya dianggap duplikat jika **Brand + WA + Email** ketiganya sama persis.
   - Jika nomor WA atau emailnya sama tetapi nama brand-nya berbeda (misal holding company yang punya banyak brand kosmetik), data **tetap disimpan dan tidak dibuang**.

2. **Pencegahan Duplikat Brand Saat Scraping:**
   - Dalam 1 sesi scraping, setiap brand hanya diambil 1 kali. Begitu nomor WA dan email brand tersebut sudah berhasil didapat, kartu produk lain dari brand tersebut dilewati secara instan tanpa membuka jendela chat.

3. **Auto-Merge di Server:**
   - Jika di tabel staging sudah ada baris pending untuk suatu brand tetapi nomor WA-nya masih kosong, dan kemudian masuk data baru dari brand tersebut yang memiliki nomor WA lengkap, sistem otomatis **meng-update** baris lama sehingga datanya langsung menjadi lengkap tanpa menduplikasi baris.

4. **Deteksi Kemiripan dengan Leads Utama (Fuzzy Match):**
   - Di halaman `/scraped-leads`, sistem otomatis membandingkan setiap data baru dengan data di tabel `leads` utama:
     - Jika nomor WA sudah terdaftar pada lead yang ada, muncul badge: `⚠️ Mirip: "[Nama Lead]" (PIC: [Nama PIC])`.
     - Jika nama brand sama atau mirip (misal `Maybelline Indonesia` dengan `Maybelline`), sistem memberi sinyal kecocokan.

5. **Mekanisme Penggabungan Kontak (Multi-Contact Merge):**
   - User dapat memilih untuk **"Gabungkan Kontak"**:
     - Nomor kontak baru akan ditambahkan (misal `0812... / 0852...`).
     - Email diisi jika sebelumnya kosong.
     - Seluruh riwayat kontak tambahan dari TikTok Shop otomatis dicatat ke riwayat catatan (`lead_notes`).
     - **Tidak ada data kontak lama yang terhapus**.

---

## 3. Detail Penting DOM & Selector TikTok Shop

### A. Validasi Kategori Level 1
- **Elemen Cascader:** `[data-tid="m4b_cascader"], .arco-cascader`
- **Nilai Teks:** `.arco-cascader-view-value`
- **Trik Unmask Tooltip:** Teks kategori sering terpotong elipsis (`...`).
  Hover target:
  ```javascript
  hoverTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  hoverTarget.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  // Tunggu 350ms, baca teks dari .arco-tooltip-content
  // Ambil hanya kategori Level 1 sebelum tanda '/' atau '>'
  ```

### B. Kartu Produk & Tombol Chat
- **Kartu Produk:** `.rounded-4`
- **Stempel Pemrosesan:** Atribut `data-tnt-scraped="true"` (hanya dipasang jika kontak berhasil diambil atau toko dipastikan tidak punya kontak).
- **Nama Brand:** `.bg-neutral-bg3 .arco-typography` atau `.bg-neutral-bg3`
- **Judul Produk:** `.text-body-m-regular`
- **Tombol Chat:** Gambar SVG chat `img[src*="data:image/svg+xml"]` di dalam tombol kartu.

### C. Popover Kontak & Ikon Mata (Eye Unmasking)
- **Kontainer Popover:** `.arco-popover-inner-content` (ambil elemen terakhir di DOM).
- **Lokasi Ikon Mata:**
  - Terletak di **header baris judul `Contact Seller`** (bukan ikon copy di bawah).
  - Selector spesifik: `svg[class*="eye"], .arco-icon-eye, .arco-icon-eye-invisible, .arco-icon-eye_invisible, [class*="eye"]`
  - Fallback selector: SVG pertama di dalam div yang memuat teks `Contact Seller`.
- **Bahaya yang Pernah Terjadi (PENTING):**
  - **JANGAN** memakai selector generik `.arco-icon-hover` tanpa verifikasi, karena ikon copy di samping email dan WA juga memakai class `.arco-icon-hover`. Salah klik akan mengklik copy, bukan buka sensor mata!
- **Cara Memicu Klik Ikon Mata yang 100% Tembus:**
  ```javascript
  const eyeBtn = eye.closest('.arco-icon-hover, button, span, div') || eye;
  [eyeBtn, eye].forEach(el => {
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    if (typeof el.click === 'function') el.click();
  });
  ```

### D. Aturan Sensor & Larangan Ekstrak Data Bintang (`*`)
- Sebelum dibuka, teks di popover berbunyi:
  `ID +62 812******`
  `******i@loreal.com.id` (atau `v***i@loreal.com`)
- **Bahaya Regex Email:**
  `/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/`
  Karena karakter `*` tidak masuk dalam regex, regex ini akan memotong `******i@loreal.com.id` menjadi `i@loreal.com.id`!
- **Solusi Mutlak:**
  ```javascript
  // Hanya proses jika popover SUDAH TIDAK ADA BINTANG '*'
  if (!popover.innerText.includes('*')) {
    // Ekstrak WA dan Email bersih
  }
  ```
  Jika sampai batas waktu polling (1.75 detik) masih ada tanda bintang `*`, **abaikan kartu tersebut** dan jangan pernah disimpan ke database.

---

## 4. Mekanisme Transfer Data (Bypass CSP TikTok)

TikTok Shop menerapkan Content Security Policy (`connect-src`) ketat yang memblokir fungsi `fetch()` langsung ke domain CRM (`sales.tntkreatif.com`).
- **Solusi Utama (Inter-Window PostMessage):**
  1. Bookmarklet membuka tab CRM via `window.open('https://sales.tntkreatif.com/scraped-leads#incoming', '_blank')`.
  2. Tab CRM memasang listener `window.addEventListener('message')`.
  3. Bookmarklet mengirim data melalui `crmWin.postMessage({ type: 'TNT_LEADS_DATA', items })`.
  4. CRM otomatis menyimpan ke database via server action `saveScrapedBatch()` dan membalas `CRM_IMPORT_DONE`.
- **Solusi Cadangan (Clipboard Sync):**
  Bookmarklet otomatis menyalin data utuh ke clipboard sistem. Jika popup browser diblokir, user cukup klik tombol **"📥 Tempel Leads (Clipboard)"** di UI CRM.

---

## 5. Tabel Database Penampungan (`scraped_leads`)

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

## 6. Lokasi Kode di Proyek

- **Dokumentasi Skill Agent:** `.agents/skills/tiktok-partner-scraper/SKILL.md`
- **Schema & Enums:** `src/db/schema.ts`, `src/db/enums.ts`
- **Migrasi Database:** `drizzle/0007_scraped_leads.sql`
- **Server Actions:** `src/app/actions/scraped-lead-actions.ts`
- **API Endpoint:** `src/app/api/scraped-leads/route.ts`
- **UI & Bookmarklet:** `src/components/ScrapedLeadsClient.tsx`
- **Halaman Penampungan:** `src/app/(app)/scraped-leads/page.tsx`
- **Navigasi Sidebar:** `src/components/Sidebar.tsx`
