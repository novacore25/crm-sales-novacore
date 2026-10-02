# Catatan Keputusan

Kenapa-kenapa di balik pilihan. Kalau hanya tahu "apa", keputusan yang sama akan
diulang dengan alasan salah.

Format tiap entri: **Konteks → Keputusan → Alasan**.

---

## Arsitektur

### Supabase diganti VPS sendiri

Supabase RLS-nya rusak dan tidak bisa dipercaya. Diganti Coolify + PostgreSQL +
Drizzle + Auth.js v5. Otorisasi pindah ke sisi server lewat `requireUser`,
`requirePermission`, `requireLord`. RLS bukan lagi lapisan keamanan.

Project Supabase sudah dihapus lord pada 2026-09-30. Tidak ada kode Supabase atau
Firebase yang tersisa di repo.

### Semua primary key tetap TEXT

Diwarisi dari Firestore. Semua UUID dan angka jadi string. Migration dari mana pun
akan lebih sulit kalau diubah sekarang, dan tidak ada pengusaha yang cartel.

`users.auth_id` tetap uuid karena itu tipe dari Auth.js.

### `proxy.ts`, bukan `middleware.ts`

Next 16. Middleware memakai edge runtime secara default, dan `pg` butuh Node.

### Tidak ada PDF generator di server

Semua dokumen keluar lewat Save as PDF dari Chrome. Alasannya dua: RAM VPS sudah
sempit, dan browser menghasilkan vektor yang tajam dengan pipeline yang sama
dengan preview. Tambah pustaka PDF plus Chromium di image akan menambah berat
untuk hasil yang tidak lebih baik.

---

## Modul Documents

### Nomor tidak pernah di-generate

Keputusan yang paling sering ditantang dan paling penting.

Kantor tidak tahu apa arti setiap segmen nomor, dan tidak ada yang diversifikasi.
Jadi sistem menebak berarti sistem bisa salah. Nomor yang salah sudah tercetak ke
klien sebelum ada yang sadar, dan tidak ada cara memastikan itu salah.

Akibatnya: `nextNumber` dan `format` hanya saran. Uniqueness yang sesungguhnya
dijamin unique index `(series_id, number)`.

### Komposer nomor memakai template, bukan kode keras

Awalnya `format` berisi contoh literal: `contoh: 037/QUO-TNT/SA/IX/26`. Itu
dokumentasi, bukan konfigurasi. Tidak ada cara telling program mana bagian sequence,
mana kode surat, mana bulan.

Sekarang `format` adalah template `{seq:3}/{type}-{company}/{code}/{roman}/{yy}`.
Hanya `{seq}` dan `{code}` yang diisi orang; bulan dan tahun ikut dari tanggal.

Semua bentuk nomor ada di PDF asli kantor, jadi tidak ada yang perlu ditebak:

```
TNT quotation  037/QUO-TNT/SA/IX/26      3 digit, ada kode, ada bulan
TNT invoice    01/INV-TNT/MCN/VIII/26    2 digit, kode MCN, bulan VIII
HYPE quotation 003/QUO-HYPE               3 digit, tanpa kode
HYPE invoice   04/INV-HYPE                2 digit, tanpa kode
```

Lebar digit harus per template. Satu lebar untuk semua akan mengubah `01` jadi
`001`, dan itu nomor berbeda yang merusak arsip.

### Draft boleh menyimpan nomor

Awalnya DRAFT sengaja tidak menyimpan nomor, supaya draft yang ditinggal tidak
membakar nomor. Lord memutuskan sebaliknya: alur nyata kantor adalah nomor dulu,
lalu Instantiate dokumen. Jadi draft menyimpan nomor.

Konsekuensinya dip experimen: nomor bisa direservasi draft yang tidak pernah
terbit, dan tabrakan dilaporkan saat simpan, bukan saat print.

### Nomor issued mengunci dokumen

Nomor adalah janji ke klien. Menulis ulang isi di belakang nomor itu membuat arsip
berhenti berarti. Koreksi lewat batal lalu terbitkan ulang, atau lewat revisi.
`updateDocument` menolak apa pun yang bukan DRAFT.

### Revisi = dokumen baru yang menunjuk dokumen asli

Bukan mengedit dokumen lama. Dua dokumen dengan isi sama tapi nomor berbeda
dipilih oleh manusia, bukan diam-diam.

### Hanya lord yang boleh hapus

`deleteDocument` memanggil `requireLord`, yang melempar. Menyembunyikan tombol cuma
kenyamanan, bukan kontrol.

### Rekening dan penandatangan disimpan di dokumen, bukan dibaca dari tabel

Kalau tabelnya diubah, dokumen lama akan berubah retroactive. Dokumen lama harus
menjadi bukti apa yang dicetak saat itu.

### Daftar rekening, penandatangan, dan kode surat belajar sendiri

Nilai baru yang diketik disimpan supaya muncul di dropdown berikutnya. Semua
bersifat per perusahaan atau per seri, jadi TNT tidak akan bisa dapat rekening HYPE.

Tidak ada halaman settings. Nilai-nilai ini jarang berubah, jadi halaman settings
tidak akan pernah dibuka.

---

## Yang dipelajari dari bug

Bagian ini yang paling mahal untuk condemn ulang.

### Tiga bug lolos dari `tsc` dan `next build`

**Query nomor duplikat tidak mengecualikan dokumen sendiri.** Begitu draft boleh
punya nomor, `issueDocument` akan menemukan barisnya sendiri dan melaporkan
dokumen itu sebagai duplikat dari dirinya sendiri. Tidak ada draft yang punya
nomor yang bisa terbit. Diperbaiki dengan `ne(documents.id, id)`.

**`min-height: 100%` tidak resolve.** Persentase diukur terhadap tinggi induknya,
dan induknya `height: auto`. Sheet cuma setinggi isinya. Diperbaiki dengan
`min-h-[297mm]`.

**`sticky bottom-0` menarik footer ke atas.** Sticky mengukur posisi terhadap area
yang di-scroll, yaitu panel preview, bukan kertas. Footer mendarat 105mm di atas
dasar kertas. Diperbaiki dengan menyerahkan positioning ke flex layout.

### Kotak mystery di sekitar logo TNT

Hanya muncul di PDF, tidak di layar. Ternyata ada di file SVG kantor sendiri:
logo memakai luminance mask, dan tepi mask jatuh dalam satu piksel dari bounding
box logo, sehingga sisa antialias-nya kelihatan sebagai garis.

Tiga cara sudah dicoba dan gagal: batas mask eksplisit, `mask-type="luminance"`,
dan mengganti CSS background dengan `<img>`. Buang mask menghilangkan garisnya tapi
logo jadi di atas kotak hitam, karena mask itulah yang menembus background logo.

Akhirnya mark-nya diambil dari artwork 615px milik mereka sendiri, di-alpha-kan
jadi PNG biasa tanpa mask, lalu script `strip-tnt-logo.py` menghapus versi
bertipe mask dari kedua SVG.

### PNG logo dari lord tidak bisa dipakai

`logo-tnt-lanscape.png` punya mark 67px. Pada 16,4mm yang jadi 99 dpi, cukup untuk
layar tapi jelas lunak saat cetak. Standar cetak 300 dpi.

Ternyata artwork SVG mereka punya mark yang sama di 615px, yang menghasilkan 472
dpi. Itu yang dipakai.

### Artwork ter-crop 14mm

Header punya padding 14mm. Background 210mm di-center di 182mm, lalu dipotong
karena CSS memotong background mengikuti elemennya. Semua artwork ter-inset dari
dua tepi.

Ditemukan dengan membandingkan piksel-per-pikjel terhadap PDF asli lord: 12,57%
berbeda sebelum, 0,58% sesudah.

### Migrasi yang "sukses" tapi nol baris

`UPDATE` dengan pola `LIKE 'contoh:037/%'` tidak kena karena nilai aslinya
`contoh: 037/...` dengan spasi. Tidak ada error. Tabel tetap ada, format tetap
salah.

### Mengukur posisi teks: empat jebakan, semuanya Dietermeasuring

Semuanya muncul saatingan yang ruang tanda tangannya. Semuanya menghasilkan
angka yang terlihat yakin dan salah. Semuanya sudah diperbaiki, tapi catatannya
lebih berharga daripada perbaikannya.

**Stylesheet basi lebih berbahaya daripada stylesheet yang tidak ada.** Harness
memakai `app.css` hasil build Tailwind dari sesi sebelumnya. Classe
`mt-[13.3mm]` yang baru tidak ada di sana, jadi margin itu tidak berlaku sama
sekali, dan hasilnya "jarak 1,9mm" — padahal yang diukur adalah dokumen tanpa
margin. Tidak ada error, tidak ada peringatan._build ulang dari
`src/app/globals.css` setiap kali kelas berubah.

**`@import` Google Fonts hilang diam-diam.** CLI Tailwind membuang import Inter
karena aturan `@import` harus mendahului yang lain. Hasilnya `app.css` menyebut
Inter di `--font-sans` tapi tidak pernah memuatnya, jadi harness dirender dengan
font cadangan yang line-height-nya berbeda dari produksi. Setiap jarak dalam
milimeter jadi tidak berarti. Verifikasi harus `document.fonts.check()` dulu,
bukan berasumsi.

**Chromium memecah satu baris jadi banyak span.** Dengan Inter termuat,
`General Manager` jadi `General` + `Manager`, `Thank you,` jadi `Thank` +
`you,`, `RUBEN ARIANTO` jadi `RUBEN` + `ARIANTO`. Celah antar span kadang
benar-benar spasi, kadang nol, jadi tidak ada ambang yang bisaandrekonstruksi
teks. Yang berhasil: buang semua spasi dari kedua sisi sebelum dibandingkan.

**`position: fixed` tidak bisa diukur lewat `getBoundingClientRect`.** Footer
adalah `print:fixed`, jadi posisinya relatif ke viewport, bukan ke kertas. Dengan
viewport 1300px dan A4 1122,5px, kaki halaman selalu terbaca "meluar" 177px.
Anak dari elemen fixed mewarisi offset-nya walau `position: relative`, jadi
harus ikut dicek sampai ke leluhurnya. Dan `documentElement.scrollHeight` tidak
pernah bisa lebih kecil dari tinggi viewport, jadi selalu membaca 1300 apa pun
yang terjadi — bukan sinyal luapan sama sekali. Yang benar-benar menutup
pertanyaan: **jumlah halaman di PDF.**

---

## Open

Hal-hal yang perlu dilanjutkan.

### Belum diterapkan ke produksi

- Perataan kolom Tabel HYPE masih memakai satu set lebar untuk quotation dan
  invoice, padahal di PDF aslinya berbeda. Quotation memberi Total 42%, invoice
  memberi Details 48%. Belum disentuh karena Lord bilang cukup sesuai SVG.

### Menunggu keputusan lord

- Tinggi kertas dan posisi vertikal. PDF asli TNT 370mm, sekarang A4 297mm. Tidak
  ada pemetaan yang "benar". Lord sudah bilang cukup mengikuti SVG.

### Perlu dicek berkala

- Health data dashboard: 9 win tanpa PIC, 12 lead MCN dengan funnel tidak lengkap,
  19 lead dengan baris Close Win kembar. Ini surfaced untuk diperbaiki manual.
- KAHF ada dua record lead yang terpisah.