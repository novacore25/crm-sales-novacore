# Arsitektur

Struktur aplikasi dan database. Untuk alasannya, baca `docs/DECISIONS.md`.

---

## Bentuk umum

Next.js 16 App Router, TypeScript, PostgreSQL, Drizzle ORM, Auth.js v5.

```
src/
  proxy.ts              rewrite /auth ke route ourselves (Node runtime untuk pg)
  db/
    schema.ts           19 tabel, satu file
    enums.ts            11 enum Postgres
    index.ts            koneksi + instance drizzle
  lib/                  helper murni, tanpa DB, tanpa React
    auth.ts             requireUser / requirePermission / requireLord
    document-number.ts  parseTemplate / composeNumber / extractCode
  app/
    (app)/              halaman setelah login
    actions/            server action, semua write lewat sini
  components/           komponen client
drizzle/                migrasi SQL
public/documents/       artwork kop: tnt-quotation.svg, tnt-invoice.svg,
                        hype-header.svg, logo-tnt-mark.png
docs/                   audit dan catatan keputusan
scripts/                alat bantu, bukan bagian app
```

`src/lib/` tidak boleh mengimpor DB atau React. Itu yang bikin
`document-number.ts` bisa diuji tanpa database, dan itu alasannya
`scripts/check-number-composition.ts` bisa jalan sendiri.

---

## Otorisasi

RLS sudah tidak dipakai. Tiga fungsi di `src/lib/auth.ts`:

| Fungsi | Untuk siapa |
|---|---|
| `requireUser` | siapa pun yang sudah login |
| `requirePermission(x)` | punya izin tertentu |
| `requireLord` | hanya lord. Melempar, bukan mengembalikan null |

Pemeriksaan di server, bukan di UI. Tombol yang disembunyikan itu kenyamanan,
bukan kontrol — karena itu `deleteDocument` memanggil `requireLord` dan bukan
sekarang disembunyikan.

---

## Database

19 tabel:

| Kelompok | Tabel |
|---|---|
| User | `users`, `role_permissions` |
| Leads | `leads`, `lead_notes`, `funnel_history`, `edit_requests`, `tasks` |
| Target | `global_targets`, `individual_targets` |
| Audit | `global_audit_logs` |
| OI | `oi_forecasts`, `oi_targets` |
| Dokumen | `documents`, `document_items`, `document_series`, `document_number_codes`, `document_bank_accounts`, `document_signatories` |
| Lain | `app_settings` |

Semua primary key TEXT, diwarisi dari Firestore. Pengecualian: `users.auth_id`
tetap uuid karena itu tipe dari Auth.js.

`product` dan `document_company` itu dua hal berbeda. MCN adalah produk yang
dijual lewat kop TNT, jadi "logo mana yang atas" dan "produk apa ini" pertanyaan
yang berbeda. Perusahaan memetakan ke template; produk tidak.

---

## Modul Documents

### Tabel

- `document_series` — satu baris per (perusahaan, jenis dokumen). Menyimpan
  `format` sebagai template dan `next_number` sebagai saran.
- `documents` — dokumennya. Nomor ada di sini, bukan di item.
- `document_items` — baris tabel di dalam dokumen.
- `document_number_codes`, `document_bank_accounts`, `document_signatories` —
  daftar yang belajar sendiri. Nilai baru yang diketik tersimpan supaya muncul
  di dropdown berikutnya.

### Nomor

`format` di `document_series` adalah template sungguhan:

```
{seq:3}/{type}-{company}/{code}/{roman}/{yy}
```

Perakitnya di `src/lib/document-number.ts`. Hanya `{seq}` dan `{code}` diisi
orang; `{roman}` dan `{yy}` dibaca dari `issueDate`. Ganti tanggal, nomornya
ikut berubah.

Jaminan keunikan bukan dari `next_number`, tapi dari unique index
`(series_id, number)`. Postgres memperlakukan NULL berbeda-bedanya, jadi
draft tanpa nomor tidak bentrok sama sekali.

### Lifecycle

| Status | Arti |
|---|---|
| DRAFT | sedang diketik. Boleh diubah, boleh sudah punya nomor |
| ISSUED | nomor sudah keluar. Kunci, tidak bisa diubah |
| CANCELLED | nomor sudah terpakai dan tidak akan dipakai ulang |
| REVISION | pengganti ISSUED, nomor sama dengan akhiran /R1 |

`updateDocument` menolak apa pun yang bukan DRAFT. Revisi bukan edit: dokumen
lama tetap utuh di arsip, dan dokumen baru menunjuk ke yang lama.

---

## Printing

Semua dokumen keluar lewat Save as PDF dari Chrome. Tidak ada PDF generator di
server.

`@page { size: A4; margin: 0 }`, sheet 210 x 297mm. Kop dan kakifoil di
background image, di-crop oleh tinggi elemen. `Letterhead` sudah membawa
`margin: '0 -14mm'` sendiri — jangan juga diberi di pemanggil, karena akan
terpakai dua kali dan artwork jadi bergeser.

Reproduksi bug yang cuma muncul di PDF:

```
render -> Chromium emulate_media('print')
       -> page.pdf(prefer_css_page_size=True, print_background=True)
       -> baca hasilnya dengan pymupdf
```

Bukan screenshot browser.

---

## Verifikasi

| Untuk | Cara |
|---|---|
| SQL | cetak `query.toSQL()`, baca params-nya |
| Layout cetak | render di Chromium, pdf, ukur hasilnya |
| Migrasi | BEGIN lalu ROLLBACK dulu, lalu bandingkan isinya |
| Perhitungan | pure function plus assertion script |

`tsc` dan `next build` tidak menghitung sebagai verifikasi untuk SQL, migrasi,
maupun layout. Lihat `AGENTS.md` Aturan 1.
