# AGENTS.md

CRM Sales — TNT & HYPE. Next.js 16 di Coolify/VPS, PostgreSQL, Drizzle, Auth.js v5.

**Baca file ini sebelum menyentuh kode.**

---

## Siapa yang Anda ajar

Pemilik dan ALU dari bisnis ini. Bukan developer. Mengurus leads, OI, dan dokumen
quotation/invoice yang benar-benar keluar ke klien.

Artinya:

- Bahasa Indonesia. Kalau ada istilah teknis yang tidak bisa dihindari, jelaskan
  sekali dengan analogi dari bisnisnya, lalu pakai seterusnya.
- Jawaban pendek untuk pertanyaan pendek. Jangan tempel dump log kalau tidak ditanya.
- Dia ingat semua aturan bisnis. Kalau dia bilang "rekening cuma invoice", itu
  aturan, bukan saran. Jangan ditawar.
- Kalau tidak ingat, katakan saja. Lebih baik "saya cek dulu" daripada menebak.
- Emoji sedikit. Maksimal satu atau dua per balasan.

---

## Isi repository

```
src/app/(app)/      halaman setelah login
src/app/actions/    server actions, semua write lewat sini
src/components/     komponen client
src/db/schema.ts    seluruh tabel, satu file
src/lib/            helper murni, tanpa DB dan tanpa React
drizzle/            migrasi SQL, dijalankan manual ke produksi
docs/               audit dan catatan keputusan
```

`proxy.ts`, bukan `middleware.ts`. Next 16, butuh Node runtime untuk `pg`.

---

## Aturan 1 — build tidak membuktikan apa pun

`npx tsc` dan `npm run build` lolos pada bug yang benar-benar rusak di produksi:

- Query cek nomor duplikat tidak mengecualikan dokumen sendiri. Akibatnya draft
  yang sudah punya nomor tidak akan pernah bisa diterbitkan.
- `min-height: 100%` tidak resolve karena induknya `height: auto`. Akibatnya footer
  melayang 105mm di atas dasar kertas.
- Background image ter-crop 14mm di kedua tepi karena ter-center di kotak yang
  terlalu kecil.

Cara membuktikan yang benar:

| Untuk | Cara |
|---|---|
| SQL | cetak `query.toSQL()` lalu periksa params-nya |
| Layout cetak | render di Chromium, `emulate_media('print')`, `page.pdf()`, ukur hasilnya |
| Migrasi | jalankan dengan BEGIN lalu ROLLBACK dulu, lalu verifikasi isinya |
| Perhitungan angka | pure function plus assertion script |

Kalau hanya bisa satu cara verifikasi, pilih yang mengukur **hasil akhir**, bukan
yang memeriksa apakah ada error.

---

## Aturan 2 — migrasi

Migrasi dijalankan manual oleh user lewat `docker exec`. Satu perintah per baris,
tanpa `\` continuation, karena perintah panjang dari chat sering terpotong.

```
scp drizzle/00XX.sql root@IP:/tmp/mig00XX.sql
docker cp /tmp/mig00XX.sql CONTAINER:/tmp/mig00XX.sql
docker exec -i CONTAINER psql -U postgres -d sales_novacore -v ON_ERROR_STOP=1 -c "BEGIN" -f /tmp/mig00XX.sql -c "ROLLBACK"
docker exec -i CONTAINER psql -U postgres -d sales_novacore -v ON_ERROR_STOP=1 -f /tmp/mig00XX.sql
```

- "Tidak error" tidak berarti benar. Pernah migrasi sukses padahal nol baris kena
  karena pola `LIKE` salah diam-diam. Tidak ada error sama sekali.
- Setelah migrate, selalu jalankan query verifikasi dan **bandingkan isinya**,
  bukan cuma cek status.
- `psql -1` bukan dry run. Dia commit kalau sukses.
- Semua migrasi idempoten. `IF NOT EXISTS` atau `ON CONFLICT DO NOTHING`.
- Kalau perlu membetulkan baris yang mungkin sudah terlanjur ter-apply, tambahkan
  `UPDATE` bersyarat yang dijaga exact string lamanya. `INSERT` saja tidak cukup.
- Jangan tulis `admin=NULL` atau tanggal karangan di SQL verifikasi. Guard
  `(${admin}::text IS NULL OR ...)` hanya jalan kalau di-bind sebagai parameter
  asli. Tiga file verifikasi saya sendiri pernah salah begini.
- Backtick di dalam template literal `sql` mematikan build. Pakai double quote.

---

## Aturan 3 — jangan mengarang aturan bisnis

Dulu ada blokir panjang karena arti kode `SA` dan `MCN` belum jelas. Jawabannya
sudah ada di PDF sendiri:

```
Quotation TNT → 037/QUO-TNT/SA/IX/26     kode SA
Invoice TNT   → 01/INV-TNT/MCN/VIII/26   kode MCN
Quotation HYPE → 003/QUO-HYPE             tidak ada kode
Invoice HYPE   → 04/INV-HYPE              prefix sudah dikonfirmasi lord
```

**Sebelum bertanya, cek PDF asli di `C:\Users\Banzilla\Downloads`.** Hampir selalu
jawabannya sudah ada di sana.

Kalau harus bertanya, tanyakan pilihan dengan konsekuensi, bukan pertanyaan terbuka.

---

## Aturan 4 — nomor dokumen

Nomor tidak pernah di-generate. Diketik manual, karena aturannya tidak seragam dan
tidak ada yang diversifikasi. Sistem yang menebak nomor bisa salah, dan nomor yang
salah sudah tercetak sebelum ada yang sadar.

Nomor disusun dari template di `document_series.format`:

```
{seq:3}/{type}-{company}/{code}/{roman}/{yy}
```

Hanya `{seq}` dan `{code}` diisi orang. Bulan romawi dan tahun ikut dari tanggal
dokumen, jadi mengubah tanggal ikut mengubah nomor.

- Lebar digit ada di template. Kantor mencetak `037` di quotation tapi `01` di
  invoice. Satu lebar untuk keduanya menghasilkan nomor yang salah.
- HYPE punya template lebih pendek dan tidak punya `{code}`.
- Kode surat per seri, bukan per perusahaan. Disimpan di `document_number_codes`.
- Perakitnya ada di `src/lib/document-number.ts`, pure, diuji oleh
  `scripts/check-number-composition.ts`. Tambah assertion setiap kali berubah.

---

## Aturan 5 — aturan bisnis dokumen

Sudah dikonfirmasi lord:

| | Quotation | Invoice |
|---|---|---|
| Arti | penawaran | tagihan |
| Rekening perusahaan | tidak ada | ada |
| Prefix | QUO | INV |
| Lebar urut TNT | 3 digit | 2 digit |
| Lebar urut HYPE | 3 digit | 2 digit |

Rekening hanya invoice sudah diterapkan. Prefix dan lebar urut **belum**, lihat
`docs/DECISIONS.md` bagian Open.

---

## Printing

Semua dokumen keluar lewat Save as PDF dari Chrome. Tidak ada PDF generator di
server, supaya RAM VPS tidak terbebani dan hasilnya tetap tajam.

- `@page { size: A4; margin: 0 }`
- Background graphics harus ON di dialog print. Kalau mati, kop tidak tercetak.
- margins None, paper A4
- Ukuran selalu A4, 210 x 297 mm

Bug yang hanya muncul di PDF harus direproduksi begini: render, Chromium
`emulate_media('print')`, `page.pdf(prefer_css_page_size=True, print_background=True)`,
lalu baca hasilnya dengan pymupdf. Bukan screenshot browser.

Catatan penting: background image ter-center di elemen yang lebih sempit akan
ter-crop, karena CSS memotong background mengikuti elemennya. Kalau artwork dibuat
menyambung ke tepi, elemennya harus full bleed dulu.

---

## Commands

```
npx tsc --noEmit
npm run build
npx tsx scripts/check-number-composition.ts
```

`npm run build` gagal dengan "DATABASE_URL is not set". Itu bukan error kode.
Isi env dummi kalau mau build lokal.

`render-preview.tsx` menghasilkan harness HTML di folder temp. Karena memakai path
absolut `/documents/...`, harus diserve lewat HTTP. Kalau dibuka lewat `file://`,
background image tidak resolve dan hasilnya menyesatkan.

---

## Communication

- Satu perintah shell per baris. Jangan pernah pakai `\` atau perintah panjang.
- Jangan pernah minta user menempelkan secret. Sudah dua kali password-nya
  bocor ke chat. Suruh dia ambil sendiri dari Coolify.
- Output error dari user harus dibaca benar-benar. Dia paste supaya dibaca.
- Kalau tidak bisa yakin benar, bilang belum yakin. Jangan menulis
  "pasti" tanpa bukti.

---

## Yang belum selesai

Baca `docs/DECISIONS.md` bagian Open. Ada beberapa yang sudah dikerjakan tapi belum
diverifikasi ke produksi, dan beberapa yang menunggu keputusan lord.