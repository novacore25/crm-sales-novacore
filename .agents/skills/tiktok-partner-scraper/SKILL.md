---
name: tiktok-partner-scraper
description: Scrapes brand names, product titles, unmasked WhatsApp numbers, and seller emails from TikTok Shop Partner Center (Product Marketplace). Handles auto-scroll, duplicate prevention, popup cleanup, and staging integration in CRM Sales NovaCore.
---

# TikTok Shop Partner Center Lead Scraper & CRM Staging

## 1. Domain & URL Konteks
- **Target URL:** `https://partner.tiktokshop.com/affiliate-product-management/product-marketplace` (Product Marketplace di TikTok Shop Partner Center).
- **Target CRM:** `https://sales.tntkreatif.com/scraped-leads` (Tabel Penampungan Leads Staging di VPS NovaCore).
- **Tujuan Bisnis:** Mengambil data prospek seller/brand (Nama Brand, Kategori Level 1, Nomor WhatsApp, Email, dan Contoh Produk) secara cepat, akurat tanpa data sensor, dan aman dari blokir CSP browser.

---

## 2. Arsitektur Alur Sistem (End-to-End Flow)

```
[TikTok Shop Marketplace di Browser]
       │
       ▼ (1. Validasi Kategori Level 1 via Cascader Tooltip)
[Pilih Kategori Produk] ──> Jika belum pilih: Alert & Berhenti
       │
       ▼ (2. Input Target Leads & Floating Control Box)
[User isi Target: misal 100 leads]
       │
       ▼ (3. Handshake Wajib: Ambil Buku Catatan Brand dari CRM)
[Buka Popup Kilat: /sync-brands] ──> CRM kirim daftar brand via postMessage
       │                               ├── Sukses: Catat ke Set knownBrands & tutup popup
       │                               └── Timeout (8s): STOP SCRAPER SEKETIKA! (Cegah dobel)
       ▼ (4. Loop Kartu Produk .rounded-4)
[Cek Nama Brand] ──> Jika Brand ada di knownBrands / sesi ini:
       │             SKIP KARTU SEKETIKA 0ms (Anti dobel database & anti dobel sesi)
       ▼
[5. Hover Kartu Produk] ──> Redupkan kartu & render tombol aksi [Copy] [Chat] [Select]
       │
       ▼ (6. Klik Ikon Chat di Kartu / Sibling Tombol Select)
[Klik Tombol Chat] ──> Tunggu 350ms popover .arco-popover-inner-content muncul
       │
       ▼ (7. Deteksi & Klik Ikon Mata Sensor - Eye Unmasking)
[Klik Ikon Mata di Header 'Contact Seller'] ──> Dispatch mousedown, mouseup, click
       │                                        ke tombol & SVG sekaligus
       ▼
[8. Polling Adaptif & Syarat Mutlak Bebas Bintang '*']
  - Cek tiap 50ms (maksimal 35 putaran = 1.75 detik).
  - Jika putaran ke-8 masih bertanda bintang: Klik ulang ikon mata otomatis.
  - Begitu tanda bintang '*' hilang: Langsung ekstrak tanpa menunggu timeout!
  - JIKA MASIH ADA BINTANG '*': REJECT! Dilarang simpan data setengah matang.
       │
       ▼ (9. Real-Time Auto Backup)
  - Simpan tiap kartu ke localStorage ('tnt_scraped_backup').
  - Tambahkan brand ke knownBrands Set.
  - Salin tiap 5 kartu ke Clipboard komputer.
       │
       ▼ (10. Pure Infinite Scroll & Deteksi Kartu Baru)
  - Jika kartu di layar habis: scroll window & scrollable container ke bawah.
  - Toleransi hingga 45 idle scrolls sampai target terpenuhi.
       │
       ▼ (11. Bypass CSP TikTok via postMessage / Clipboard)
[Klik Tombol 'Buka & Simpan ke CRM']
       │
       ├── Jalur Utama: window.open('/scraped-leads#incoming') + postMessage
       └── Jalur Cadangan: Tombol 'Tempel Leads (Clipboard)' di UI CRM
       │
       ▼ (12. Server Action: saveScrapedBatch)
[Tabel Penampungan: scraped_leads di Database VPS]
  - Validasi ketat backend: Tolak nomor/email berbintang atau email terpotong.
  - Auto-Merge Pending Brand: Jika brand sama sudah ada di DB tanpa WA,
    dan data baru punya WA lengkap, UPDATE baris lama agar lengkap tanpa baris dobel.
  - Deteksi kemiripan otomatis dengan tabel leads utama.
```

---

## 3. Detail Penting DOM & Selector TikTok Shop

### A. Validasi Kategori Level 1 (Wajib Sebelum Scraping)
- **Elemen Cascader:** `[data-tid="m4b_cascader"], .arco-cascader`
- **Nilai Teks:** `.arco-cascader-view-value`
- **Trik Unmask Tooltip:** Teks kategori sering terpotong elipsis (`...`).
  Hover target:
  ```javascript
  hoverTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  hoverTarget.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  // Tunggu 350ms, baca text dari .arco-tooltip-content
  // Ambil hanya kategori Level 1 sebelum tanda '/' atau '>'
  ```

### B. Kartu Produk, Tombol Chat, & Unmasking Nama Brand
- **Kartu Produk:** `.rounded-4`
- **Stempel Pemrosesan:** Atribut `data-tnt-scraped="true"` (hanya dipasang jika kontak berhasil diambil atau toko dipastikan tidak punya kontak).
- **Nama Brand:** `.bg-neutral-bg3 .arco-typography` atau `.bg-neutral-bg3`
- **Aturan Unmasking Nama Brand (Anti Titik-Titik '...'):**
  - Cek terlebih dahulu atribut `title` di elemen `brandEl` atau `brandEl.querySelector('[title]')`.
  - Jika nama brand masih terpotong elipsis (`...` atau `…`, contoh `Beningsindonesiaoffi...`):
    - Lakukan event hover `mouseenter` dan `mouseover` ke elemen brand.
    - Tunggu 220ms hingga tooltip Arco muncul di DOM (`.arco-tooltip-content`).
    - Ekstrak teks utuh dari tooltip (buang rating seperti `(★4.9)`).
    - Dispatch `mouseleave` dan sembunyikan tooltip kembali.
- **Aktivasi Overlay Kartu Produk (Wajib Hover Kartu Terlebih Dahulu):**
  - Tombol aksi `[Copy] [Chat] [Select]` dan efek redup kartu **TIDAK MUNCUL** jika kartu belum di-hover.
  - Sebelum mencari tombol chat, script WAJIB dispatch `mouseenter` & `mouseover` ke elemen kartu `card`.
- **Selector Tombol Chat (Dual Method):**
  - Method 1: `card.querySelector('img[src*="data:image/svg+xml"], svg[class*="chat"], .arco-icon-message')`
  - Method 2 (Bulletproof Fallback): Tombol persis di sebelah kiri tombol hijau "Select" (`selectBtn.previousElementSibling`).
- **Judul Produk:** `.text-body-m-regular`
- **Cleanup State:** Dispatch `mouseleave` ke tombol chat dan kartu `card` setelah selesai agar kartu kembali ke tampilan normal.

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

## 4. Kecepatan, Anti Duplikat Brand, & Pemenuhan Target 100%

Di TikTok Shop Product Marketplace, beberapa produk yang berdekatan seringkali berasal dari toko/brand yang sama (misal 5 produk Garnier).
- **Aturan Bisnis:** 1 sesi scraping hanya memerlukan 1 kontak unik per brand.
- **Logika Lewati Duplikat:**
  ```javascript
  if (brand && items.some(it => it.brand.toLowerCase() === brand.toLowerCase())) {
    continue; // Lewati seketika dalam 1ms, jangan buka jendela chat
  }
  ```
- **Pemenuhan Target Penuh (Gas Terus Sampai Target via Infinite Scroll):**
  TikTok Shop Marketplace menggunakan antarmuka **pure infinite scroll**. Jika user meminta 50 leads dan menemukan duplikat di baris awal, scraper **TIDAK BOLEH BERHENTI**. Scraper otomatis scroll ke bawah terus menerus (toleransi hingga 45 siklus) sampai jumlah `items.length` benar-benar mencapai 50 leads unik yang valid.
- **Loading Baris Tertentu Saja:**
  Menunggu loading hanya dilakukan pada kartu/baris yang sedang diproses (sampai ikon chat muncul, maksimal 2.4 detik). Tidak ada spinner global yang menahan seluruh halaman.
- **Tampilan Status Ringkas:**
  Status popup fokus pada indikator angka: `[X/Target] Brand (Kontak)` atau `[X/Target] Memuat data...`.

---

## 5. Mekanisme Transfer Data (Bypass CSP TikTok)

TikTok Shop menerapkan Content Security Policy (`connect-src`) ketat yang memblokir fungsi `fetch()` langsung ke domain CRM (`sales.tntkreatif.com`).
- **Solusi Utama (Inter-Window PostMessage):**
  1. Bookmarklet membuka tab CRM via `window.open('https://sales.tntkreatif.com/scraped-leads#incoming', '_blank')`.
  2. Tab CRM memasang listener `window.addEventListener('message')`.
  3. Bookmarklet mengirim data melalui `crmWin.postMessage({ type: 'TNT_LEADS_DATA', items })`.
  4. CRM otomatis menyimpan ke database via server action `saveScrapedBatch()` dan membalas `CRM_IMPORT_DONE`.
- **Solusi Cadangan (Clipboard Sync):**
  Bookmarklet otomatis menyalin data utuh ke clipboard sistem. Jika popup browser diblokir, user cukup klik tombol **"📥 Tempel Leads (Clipboard)"** di UI CRM.

---

## 6. Integrasi Server & Database (`scraped_leads`)

- **Tabel:** `scraped_leads` (PostgreSQL di VPS Coolify).
- **Status:** `'pending'` (belum ditarik), `'promoted'` (sudah jadi lead utama), `'ignored'` (diabaikan).
- **Server Action:** `src/app/actions/scraped-lead-actions.ts`
- **Aturan Auto-Merge di Server:**
  Jika brand sudah ada di status pending tetapi kontak WA lama kosong, sedangkan data baru memiliki nomor WA lengkap, server akan **meng-update** baris lama alih-alih membuat baris ganda.
- **Auto-Clean:** Setiap kali halaman `/scraped-leads` dimuat, server otomatis membersihkan sisa baris sampah tanpa nomor WA dan email berbintang.
