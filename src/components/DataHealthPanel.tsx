'use client';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import { useState } from 'react';
import type { DataHealthRow } from '@/app/actions/analytics-actions';
import { cn } from '@/lib/utils';

const rupiah = (n: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);

/**
 * Data Health: won leads whose funnel does not support the scorecard.
 *
 * Read-only by design. It tells the lord which rows to repair and who last
 * touched them, and it links to each lead. It cannot repair them, because
 * whether a stage "really happened" depends on a conversation nobody wrote
 * down, and inserting the row anyway would make the dashboard look right while
 * making the data a fabrication.
 *
 * The alternative - showing nothing until the data is clean - is how a bad
 * number survives: 22 deals were reported as closing without a response and
 * nobody knew, because the scorecard was clamped to a tidy 100% and looked
 * perfect.
 */
export default function DataHealthPanel({ rows }: { rows: DataHealthRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-emerald-200 p-6 md:p-8 shadow-sm">
        <h4 className="text-sm font-black text-emerald-700 uppercase tracking-widest mb-2 flex items-center gap-2">
          <div className="w-1.5 h-4 bg-emerald-600 rounded-full"></div>
          Data Health
        </h4>
        <p className="text-xs text-slate-500">
          Semua {rows.length === 0 ? 'deal yang sudah Close Win' : ''} punya catatan stage yang
          lengkap. Tidak ada yang perlu dilengkapi.
        </p>
      </div>
    );
  }

  const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);
  const noHistory = rows.filter((r) => r.lastStage === null);
  const unattributed = rows.filter((r) => !r.lastBy);

  return (
    <div className="bg-white rounded-3xl border border-amber-200 p-6 md:p-8 shadow-sm">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h4 className="text-sm font-black text-amber-800 uppercase tracking-widest mb-2 flex items-center gap-2">
            <div className="w-1.5 h-4 bg-amber-500 rounded-full"></div>
            Data Health &mdash; Funnel Tidak Lengkap
          </h4>
          <p className="text-xs text-slate-600 leading-relaxed max-w-3xl">
            <span className="font-black text-amber-800">{rows.length} deal</span> berstatus Close
            Win tapi tidak punya catatan <span className="font-bold">Responsed</span> dan/atau{' '}
            <span className="font-bold">Set Meeting</span>. Total nilainya{' '}
            <span className="font-black text-amber-800">{rupiah(totalRevenue)}</span>.
            Scorecard menghitung win dibagi respons, jadi selama stage ini kosong angkanya tidak bisa
            dipercaya &mdash; bukan karena timnya bagus atau buruk, tapi karena datanya belum lengkap.
          </p>
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          className="shrink-0 flex items-center gap-2 px-4 py-2 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 rounded-xl text-[11px] font-black uppercase tracking-widest transition"
        >
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          {open ? 'Sembunyikan' : `Lihat ${rows.length} lead`}
        </button>
      </div>

      {/* The two sub-groups that need different fixes, called out separately so
          the lord does not have to read 100 rows to find the ones with no
          owner. Each says what to do, not just what is wrong - a count of
          broken rows is only useful if someone is going to go and fix them. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {noHistory.length > 0 && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-rose-700 mb-1">
              1. Tanpa riwayat sama sekali
            </p>
            <p className="text-[11px] text-slate-600 leading-relaxed mb-2">
              <span className="font-black text-rose-700">{noHistory.length} lead</span> ({rupiah(noHistory.reduce((s, r) => s + r.revenue, 0))})
              tidak punya satu pun baris funnel, jadi tidak ada catatan siapa yang menutupnya. They'd
              muncul di Individual Target Contribution sebagai baris
              <span className="font-bold"> &quot;Tanpa PIC&quot;</span>.
            </p>
            <p className="text-[11px] text-rose-800 leading-relaxed">
              <span className="font-black">Yang perlu dilakukan:</span> buka tiap lead, isi PIC-nya,
              lalu catat tahap-tahapnya (Responsed, Set Meeting, Close Win) lengkap dengan tanggal yang
              sebenarnya. Kalau deal ini memang belum pernah terjadi, ubah statusnya supaya tidak
              terhitung revenue.
            </p>
          </div>
        )}
        {unattributed.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-orange-700 mb-1">
              2. Punya riwayat tapi tanpa nama
            </p>
            <p className="text-[11px] text-slate-600 leading-relaxed mb-2">
              <span className="font-black text-orange-700">{unattributed.length} lead</span> punya
              catatan tahap, tapi tidak ada nama yang masuk. Datanya ada, orangnya yang hilang.
            </p>
            <p className="text-[11px] text-orange-800 leading-relaxed">
              <span className="font-black">Yang perlu dilakukan:</span> buka tiap lead, isi PIC di
              kolomnya. Tidak perlu tambah stage baru - cukup nama, karena tahapnya sudah tercatat.
            </p>
          </div>
        )}
        {rows.length - noHistory.length - unattributed.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-800 mb-1">
              3. Tahap belum lengkap
            </p>
            <p className="text-[11px] text-slate-600 leading-relaxed mb-2">
              <span className="font-black text-amber-800">
                {rows.length - noHistory.length - unattributed.length} lead
              </span>{' '}
              sudah punya sebagian tahap, tapi ada yang belum dicatat.
            </p>
            <p className="text-[11px] text-amber-800 leading-relaxed">
              <span className="font-black">Yang perlu dilakukan:</span> tambahkan tahap yang hilang
              (kolom <span className="font-bold">kurang</span> di tabel), dengan tanggal yang
              sebenarnya. Penting: isi tanggal yang benar, bukan yang bikin angka kelihatan bagus -
              kalau tanggalnya di luar periode yang sedang dilihat, angkanya tidak akan berubah.
            </p>
          </div>
        )}
      </div>

      {open && (
        <div className="overflow-x-auto border-t border-slate-100 pt-4">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                <th className="pb-2 pr-3">Brand</th>
                <th className="pb-2 pr-3">Stage terakhir</th>
                <th className="pb-2 pr-3">Yang belum ada</th>
                <th className="pb-2 pr-3">PIC terakhir</th>
                <th className="pb-2 pr-3 text-right">Nilai</th>
                <th className="pb-2 text-right">&nbsp;</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((r) => (
                <tr key={r.leadId} className="hover:bg-amber-50/40 transition">
                  <td className="py-2.5 pr-3 text-xs font-bold text-slate-800">{r.brandName}</td>
                  <td className="py-2.5 pr-3">
                    {r.lastStage ? (
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                        {r.lastStage}
                      </span>
                    ) : (
                      <span className="text-[10px] font-black uppercase tracking-wider text-rose-600">
                        (tidak ada)
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className="inline-flex flex-wrap gap-1">
                      {r.missingStages.map((s) => (
                        <span
                          key={s}
                          className="px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-[9px] font-black uppercase tracking-wider text-amber-800"
                        >
                          {s}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    {r.lastBy ? (
                      <span className="text-[10px] font-bold text-slate-600">{r.lastBy}</span>
                    ) : (
                      <span className="text-[10px] font-bold italic text-orange-600">tanpa PIC</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-right">
                    <span
                      className={cn(
                        'text-[11px] font-black tabular-nums',
                        r.revenue > 0 ? 'text-slate-800' : 'text-slate-300',
                      )}
                    >
                      {rupiah(r.revenue)}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => router.push(`/lead/${r.leadId}`)}
                      title="Buka halaman lead untuk melengkapi stage"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 rounded-lg text-[9px] font-black uppercase tracking-widest transition"
                    >
                      <Wrench className="w-3 h-3" />
                      Lengkapi
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 100 && (
            <p className="text-[10px] text-slate-400 mt-3 flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3" />
              Menampilkan 100 lead pertama. Ada mungkin lebih dari itu &mdash; tanyakan ke lord
              sebelum menganggap ini daftar lengkap.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
