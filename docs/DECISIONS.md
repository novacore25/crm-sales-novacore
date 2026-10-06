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

### Blok penutup dokumen adalah satu kesatuan

Ketentuan, blok total, rekening, dan kedua tanda tangan dibungkus satu
`break-inside-avoid`. Semuanya memang sudah tidak bisa terbelah sendiri-sendiri,
tapi itu **bukan** hal yang sama dengan berpindah bersama: total bisa mendarat di
kaki halaman pertama sementara tanda tangan terlantar ke halaman kedua, dan itu
lebih buruk dari kedua ekstrem.

Kalau dokumen panjang, seluruh penutup pindah ke lembar kedua dan halaman pertama
cuma berisi tabel. Dokumen satu halaman tidak terpengaruh sama sekali — dan itu
yang benar-benar dipakai, karena invoice kantor tidak pernah dua halaman.

### Tiga tabel target, lalu dua dicabut

Aplikasi pernah punya tiga tabel target yang tidak saling schn. Semuanya
bertanya "berapa target bulan ini" dengan cara berbeda, dananswer-nya berbeda
pula — itu sebabnya halaman Set Targets selalu bilang "belum ada target"
padahal OI Forecast menampilkan 1,8 miliar.

Aturan bisnis yang sudah dikonfirmasi lord:

| Jenis target | Sumber | Kenapa |
|---|---|---|
| **Revenue tim** | **jumlah milestone per produk** | Satu-satunya tempat yang diisi, dan bisa memecah TNT / MCN / HYPE |
| **Chat & meeting** | **individual saja** | Tidak ada lagi target chat/meeting di level perusahaan |
| **Revenue individual** | **individual, bebas** | Boleh lebih besar atau lebih kecil dari milestone |

`global_targets` jadi **tidak terbaca dan tidak ditulis**. Tab GLOBAL di halaman
Set Targets masih ada tapi **read-only**: menampilkan total milestone beserta
rinciannya per produk, plus tombol ke OI Forecast → Milestones untuk mengubahnya.

Tabel dan datanya **sengaja tidak dihapus**. Menghapus itu migrasi destruktif
tanpa keuntungan, dan kalau angkanya someday Needed, sejarahnya masih ada.

### Target individual tidak boleh terkait dengan milestone

Ini yang paling mudah dilanggar karena kelihatan\logis untuk czasnya. Target
seseorang **tidak** diambil dari milestone, **tidak** diporar oleh milestone, dan
**tidak** dibatasi olehnya.

Lord: perusahaan bisa menargetkan satu individu dengan angka besar walaupun
milestone-nya tidak sebesar itu. Jadi sistem tidak boleh:
//
//- membagi milestone ke setiap orang
- memotong target orang kalau melebihi milestone
- menampilkan perbandingan "di atas/bawah milestone" di layar

Milestone adalah target **tim**. Target orang berdiri sendiri.

### Angka total harus bisa ditelusuri, dan yang kosong harus terlihat

Total target global ditampilkan **berserta rinciannya per produk**, bukan angka
tunggal. Total yang tidak bisa ditelusuri ke keputusan yang menghasilkannya
tidak akan dipercaya, dan memang begitu: di sinilah asalusul dua angka global
yang berbeda tanpa ada yang sadar.

Produk yang **belum punya baris** tetap ditampilkan, bertanda "Belum diisi",
dan **tidak ikut dihitung** ke total. Ini bukan detail tampilan: kalau hanya
yang ada yang dirender, bulan yang belum lengkap akan terlihat seperti bulan
yang sudah lengkap. Oktober 2026 tidak punya target MCN, dan tampilannya dulu
menunjukkan dua produk dengan total yang seolah mencakup ketiganya — angkanya
tidak salah, tapi persis menimbulkan pertanyaan yang seharusnya sudah terjawab.

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

### Harness yang merender komponennya sendiri tidak bisa menemukan bug halaman

Sidebar ikut tercetak ke PDF, dan tidak ada satu pun dari sebelas pemeriksaan
layout yang menyinggungnya. Alasannya: harness merender `DocumentPreview` secara
langsung ke HTML, tanpa lewat `AppLayout`. Yang diukur setiap kali adalah
komponennya - benar, presisi, tidak ada yang salah - tapi **bukan halaman yang
dibuka orang**.

Harness itu benar untuk apa yang dibuatnya: mengukur tinggi baris, posisi kolom,
jarak tanda tangan. Ia tidak dapat menangkap apa pun dari luar komponen, dan
itulah persis kelas bug yang paling mahal.

Pelajaran: bila sebuah bug berasal dari apa yang **melingkupi** kode, harness
harus memuat struktur itu juga - bukan hanya komponennya. Untuk halaman print,
buktinya bukan mengukur PDF lagi, tapi membaca hasil build: apakah route print
masih menarik AppLayout di manifest-nya.

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

### Route print berada DI LUAR kerangka aplikasi

`/documents/[id]/print` ada di grup `(print)`, bukan `(app)`. Layout grup itu hanya
mengembalikan children.

Dulu route ini di dalam `(app)`, jadi terbungkus AppLayout: baris flex `h-screen`
dengan sidebar 250px, kartu user, dan region toast. **Tidak satu pun dari itu
disembunyikan dari cetak, di browser mana pun**, karena memang tidak pernah ada
aturan print-nya.

Hasilnya dokumen asli keluar salah. Seorang anggota tim sales menyimpannya dari
Safari dan lembarnya membawa seluruh navigasi - "CoreDesk", "Executive
Dashboard", "Leads Database" - dengan quotation terdorong 66mm ke kanan dan
terpotong, sehingga "Official Quotation" tercetak jadi "ial Quotation" dan
"Package" jadi "kage".

Memindahkan route keluar dari shell adalah perbaikannya, bukan menyembunyikan
shell. Menyembunyikannya berarti bergantung pada `print:hidden` yang benar di
setiap mesin, sementara `h-screen` dan `overflow-hidden`-nya tetap ada di kotak
cetak - dan Safari punya sejarah panjang berbeda pendapat soal keduanya. Sidebar
yang tidak dirender adalah hal yang tidak bisa dikoreksi Safari.

Tidak ada yang hilang. Halaman print sudah memanggil `requireUser()`, yang
mengalihkan tamu belum login ke /login dan akun pending ke /pending.

Yang tidak berubah: URL-nya. Route group bukan bagian dari path.

Bukti perbaikannya, bukan Reading: manifest referensi klien route print di hasil
build **tidak berisi** AppLayout maupun Sidebar, sementara route Tetangga di
dalam `(app)` masih memuat keduanya. Kontrolnya penting - tanpanya, pemeriksaan
yang lolos mungkin lolos karena alasan yang salah.

### Staff boleh menulis deal value dan melengkapi tanggal funnel

`staff.canEditDealValue` bernilai **true**. Sebelumnya **false**, dan itu
menystoppable seluruh tim dari mencatat apa pun.

`updateLead` membuka dengan `requirePermission('canEditDealValue')`, dan modal
funnel memanggilnya **sebelum** menulis riwayat. Jadi setiap sales yang menekan
"Terapkan" mendapat exception, React menutup pesannya dengan "Minified React
error #441" di produksi, dan **tidak ada tahap yang pernah tertulis**. Bukan
sekali pun - dan gejalanyalooked seperti satu kasus, padahal sebenarnya selalu.

Yang membuatnya tidak konsisten: grid OI Forecast **sudah** membiarkan sales
mengubah nominal deal di barisnya sendiri, karena `updateOIForecastField` hanya
memakai `requireUser()`. Jadi nominal bisa diubah di satu tempat dan terkunci di
tempat lain.

Konfirmasi lord: staff boleh menulis deal value, dan boleh melengkapi tanggal
funnel yang belum terisi. Menutup deal memang pekerjaannya.

Catatan Operasional: `requirePermission` melempar, tidak mengembalikan. Kalau
dipanggil dari action yang tidak dibungkus `guardAction`, satu permission yang
salah akan muncul sebagai "Minified React error #441", bukan sebagai pesan izin
yang bisa dibaca.

### Tanggal funnel harus berurutan, tidak boleh mundur

Aturan dari lord: chat dulu, baru respon, lalu meeting, lalu Close Win atau
Close Lost. Setiap tahap yang terisi harus punya tanggal, dan tanggal-tanggal itu
tidak boleh lebih baru ke belakang.

Modal sudah menolak menutup deal bila tahap sebelumnya belum punya tanggal, tapi
tidak memeriksa **urutannya** - jadi deal bisa ditutup dengan tanggal chat yang
setelahnya.

Pemeriksaannya di `src/lib/funnel-order.ts`, murni tanpa React dan database,
dengan assertion di `scripts/check-funnel-order.ts`. Tahap yang tanggalnya tidak
ada di mana pun **dilewati**, bukan dianggap melanggar: "tidak diketahui" bukan
"lebih awal", dan menebak posisinya akan menyalahkan tahap yang salah.

Pesan error menyebut **tempat pertama** urutannya rusak, bukan selisih terbesar,
karena di situlah ada yang bisa diperbaiki.

### Grid lebar: scrollbar dipin dan kolom kiri dikunci

Tabel OI punya 16 kolom dan jauh lebih lebar dari layar. Dulu satu container
`overflow-auto` melayani sumbu **vertikal dan horizontal** sekaligus, jadi
scrollbar horizontal ikut turun ke kaki ribuan baris. Untuk membaca kolom
"Quotation" di kanan, harus menggulir ke paling bawah dulu - persis kebalikan
dari yang diharapkan.

Dua perbaikan, keduanya soal jangkauan:

**Scrollbar kedua yang dipin.** Bukan Element di luar container yang
meng-scrolling, jadi ia tidak ikut bergeser bersama baris. Ia menjaga
`scrollLeft` dua arah dengan container aslinya, dengan flag penjaga supaya
event-nya tidak saling mendorong. Lebarnya diambil dari `scrollWidth` tabel
sesungguhnya, bukan perkiraan, karena jumlah kolom dan isi sel keduanya
berubah-ubah.

**Tiga kolom kiri dikunci.** Act, Scenario, dan Brand Name tetap terlihat saat
menggeser ke kanan, jadi Anda tahu baris mana yang sedang dibaca. Offset-nya
**diukur dari sel header yang benar-benar ter-render** dan ditaruh di
`--pin-2` / `--pin-3`. Nilai di-hardcode akan langsung tumpang tindih begitu
satu nama brand panjang, dan `w-32` pada sel tabel hanyalah saran - Brand
Name memang boleh selebar yang diperlukan namanya.

Keduanya diuji di browser sungguhan lewat `scripts/render-oigrid.tsx`, bukan
dibaca saja: scrollbar cermin benar-benar menggeser tabel, dan sebaliknya tabel
menggeser scrollbar, keduanya tidak saling mendorong, dan ketiga kolom tetap
di offsetnya pada `scrollLeft` 900px.

Pelajaran dari pengujian itu: pemeriksaan pertama hanya bertanya "apakah
`position` sticky" dan "apakah latar	opaque" - keduanya **lolos tanpa ada
offset sama sekali**, persis seperti versi yang tidak mengunci apa pun. Yang
dipakai adalah nilai `left` sesudah digeser. Menguji properti, bukan
perilaku, adalah cara untuk lolos tanpa benar.

### Panah geser satu kolom

Dua tombol panah melayang di tepi kiri dan kanan grid. Sekali klik, tabel
**geser tepat satu kolom**, bukan satu layar.

Lebar kolom diambil dari kolom data yang benar-benar ter-render, bukan dari kolom
pertama. Kolom tidak seragam: `Value` lebih lebar dari `T. GMV`. Kalau melangkah
sejajar kolom pertama, kolom yang sempit akan terlewati dan tampilan berhenti di
antara dua kolom - lebih buruk daripada tidak bergerak.

Panah tidak menghalangi data. Lapisan panahnya `pointer-events-none`, jadi hanya
tombolnya yang menerima klik; mengetuk sel mana pun di dalam grid tetap masuk ke
grid, bukan ke lapisan panah.

Pengujian menemukan satu bug yang **tidak terlihat kalau hanya Reading kode**:
lapisan memakai `justify-between`, dan `justify-between` dengan **satu anak**
menaruh anak itu di **awal** baris. Karena satu ujung selalu disembunyikan, satu
tombol adalah keadaan normal - jadi panah **kanan muncul di sisi kiri**, hampir
selalu. Diperbaiki ke `justify-end`, dengan panah kiri diposisikan absolut.

Sisa yang ditutup `tsc`, bukan browser: `onClick`-nya terpasang, dan panah
hilang di ujung yang sudah digeser. Keduanya butuh React benar-benar berjalan,
yang tidak terjadi di markup statis.

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