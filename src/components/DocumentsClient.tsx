'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Plus, Search, Trash2, Ban, Send, FileCheck2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  cancelDocument,
  deleteDocument,
  getDocuments,
  issueDocument,
  type DocumentListRow,
} from '@/app/actions/document-actions';
import type { UserProfile } from '@/types';
import { cn } from '@/lib/utils';

const rupiah = (n: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600 border-slate-200',
  ISSUED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CANCELLED: 'bg-rose-50 text-rose-600 border-rose-200 line-through',
  REVISION: 'bg-amber-50 text-amber-700 border-amber-200',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'DRAFT',
  ISSUED: 'TERBIT',
  CANCELLED: 'DIBATALKAN',
  REVISION: 'REVISI',
};

const PAGE_SIZE = 25;

export default function DocumentsClient({ user }: { user: UserProfile }) {
  const router = useRouter();
  const isLord = user.role === 'lord';

  const [rows, setRows] = useState<DocumentListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [company, setCompany] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDocuments({
        page,
        pageSize: PAGE_SIZE,
        search: search.trim() || undefined,
        status,
        company,
      });
      setRows(res.rows);
      setTotal(res.total);
    } catch (e) {
      console.error(e);
      toast.error('Gagal memuat arsip dokumen.');
    } finally {
      setLoading(false);
    }
  }, [page, search, status, company]);

  useEffect(() => {
    load();
  }, [load]);

  // Any filter change must land on page 1, or a narrow filter on page 9 reads
  // as "no documents" while the count still shows a hundred.
  useEffect(() => {
    setPage(0);
  }, [search, status, company]);

  const handleIssue = async (id: string) => {
    setBusyId(id);
    try {
      const res = await issueDocument(id);
      if (!res.success) {
        toast.error(res.error ?? 'Gagal menerbitkan');
        return;
      }
      toast.success(`Nomor ${res.number} dibuat`);
      load();
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (id: string, number: string | null) => {
    if (!confirm(
      `Batalkan dokumen ${number ?? '(tanpa nomor)'}?\n\n` +
      'Nomornya tetap dipakai dan tidak akan didaur ulang. Ini disengaja: ' +
      'lubang di urutan nomor bisa dijelaskan, nomor yang dipakai dua kali tidak bisa.',
    )) return;

    setBusyId(id);
    try {
      const res = await cancelDocument(id);
      if (!res.success) {
        toast.error(res.error ?? 'Gagal membatalkan');
        return;
      }
      toast.success('Dokumen dibatalkan');
      load();
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string, number: string | null) => {
    if (!confirm(
      `HAPUS PERMANEN dokumen ${number ?? '(tanpa nomor)'}?\n\n` +
      'Nomor ini akan hilang dari arsip selamanya, dan nomor berikutnya tidak ' +
      'akan mengisinya. Ini untuk membersihkan dokumen tes - dokumen yang sudah ' +
      'terbit sebaiknya dibatalkan, bukan dihapus.',
    )) return;

    setBusyId(id);
    try {
      const res = await deleteDocument(id);
      if (!res.success) {
        toast.error(res.error ?? 'Gagal menghapus');
        return;
      }
      toast.success('Dokumen dihapus');
      load();
    } finally {
      setBusyId(null);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      <header className="py-4 md:h-20 bg-white border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between px-4 md:px-8 shrink-0 z-10 shadow-sm gap-4">
        <div className="flex flex-col shrink-0">
          <h1 className="text-lg md:text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <span className="w-2 h-5 md:h-6 bg-indigo-600 rounded-full" />
            Quotation &amp; Invoice
          </h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
            Arsip dokumen
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nomor atau klien..."
              className="pl-9 pr-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all w-full md:w-56"
            />
          </div>

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none"
          >
            <option value="ALL">Semua status</option>
            <option value="DRAFT">DRAFT</option>
            <option value="ISSUED">Terbit</option>
            <option value="CANCELLED">Dibatalkan</option>
          </select>

          <select
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none"
          >
            <option value="ALL">Semua perusahaan</option>
            <option value="TNT">Thick and Thin</option>
            <option value="HYPE">HYPE</option>
          </select>

          <button
            onClick={() => router.push('/documents/new')}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-black rounded-xl transition shadow-lg shadow-indigo-500/20 uppercase tracking-widest"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden md:inline">Buat</span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 md:p-8 custom-scrollbar">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-left">
              <thead>
                <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-200">
                  <th className="px-5 py-3">Nomor</th>
                  <th className="px-5 py-3">Klien</th>
                  <th className="px-5 py-3">Perusahaan</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Tanggal</th>
                  <th className="px-5 py-3 text-right">Total</th>
                  <th className="px-5 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-5 py-3">
                      <span className="text-xs font-black text-slate-800 tabular-nums">
                        {r.number ?? <span className="text-slate-300 italic font-normal">belum ada</span>}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => router.push(`/documents/${r.id}`)}
                        className="text-xs font-bold text-slate-800 hover:text-indigo-600 text-left"
                      >
                        {r.clientName}
                      </button>
                      <div className="text-[9px] text-slate-400">
                        {r.itemCount} item &middot; oleh {r.createdByName ?? '-'}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                        {r.company} &middot; {r.docType === 'QUOTATION' ? 'QUO' : 'INV'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          'px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-wider border inline-block',
                          STATUS_TONE[r.status] ?? STATUS_TONE.DRAFT,
                        )}
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-[10px] font-bold text-slate-500 tabular-nums">
                      {r.issueDate
                        ? new Date(r.issueDate).toLocaleDateString('id-ID', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })
                        : '-'}
                    </td>
                    <td className="px-5 py-3 text-right text-xs font-black text-slate-800 tabular-nums">
                      {rupiah(r.grandTotal)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        {r.status === 'DRAFT' && (
                          <button
                            onClick={() => handleIssue(r.id)}
                            disabled={busyId === r.id}
                            title="Terbitkan - kunci dokumen dan buat nomor"
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition disabled:opacity-40"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        )}
                        {r.status === 'ISSUED' && (
                          <button
                            onClick={() => router.push(`/documents/${r.id}`)}
                            title="Buka"
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                          >
                            <FileCheck2 className="w-4 h-4" />
                          </button>
                        )}
                        {r.status !== 'CANCELLED' && r.status !== 'DRAFT' && (
                          <button
                            onClick={() => handleCancel(r.id, r.number)}
                            disabled={busyId === r.id}
                            title="Batalkan - nomor tetap dipakai"
                            className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition disabled:opacity-40"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                        {/* Lord only. deleteDocument calls requireLord, which
                            throws, so hiding the button is a convenience and
                            not the control. */}
                        {isLord && (
                          <button
                            onClick={() => handleDelete(r.id, r.number)}
                            disabled={busyId === r.id}
                            title="Hapus permanen (khusus lord)"
                            className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition disabled:opacity-40"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-20 text-center">
                      <FileText className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                        Belum ada dokumen
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {total > PAGE_SIZE && (
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400">
                Halaman {page + 1} dari {totalPages} ({total} dokumen)
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-[10px] font-bold disabled:opacity-50 hover:bg-slate-50"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-[10px] font-bold disabled:opacity-50 hover:bg-slate-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
