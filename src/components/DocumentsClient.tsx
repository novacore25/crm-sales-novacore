'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileText,
  Plus,
  Search,
  Trash2,
  Ban,
  Send,
  FileCheck2,
  Pencil,
  Printer,
  Receipt,
  Columns2,
  Table2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  cancelDocument,
  deleteDocument,
  getDocuments,
  getNumberContext,
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

const PAGE_SIZE = 20;

export default function DocumentsClient({ user }: { user: UserProfile }) {
  const router = useRouter();
  const isLord = user.role === 'lord';

  const [viewMode, setViewMode] = useState<'columns' | 'table'>('columns');

  // Filters
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [company, setCompany] = useState('ALL');
  const [quoInvoiceFilter, setQuoInvoiceFilter] = useState<'ALL' | 'WITHOUT_INVOICE' | 'WITH_INVOICE'>('ALL');

  // State for 2-column view
  const [quoRows, setQuoRows] = useState<DocumentListRow[]>([]);
  const [quoTotal, setQuoTotal] = useState(0);
  const [quoPage, setQuoPage] = useState(0);

  const [invRows, setInvRows] = useState<DocumentListRow[]>([]);
  const [invTotal, setInvTotal] = useState(0);
  const [invPage, setInvPage] = useState(0);

  // State for single-table view
  const [tableRows, setTableRows] = useState<DocumentListRow[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tablePage, setTablePage] = useState(0);

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // The issue dialog
  const [issueTarget, setIssueTarget] = useState<DocumentListRow | null>(null);
  const [issueNumber, setIssueNumber] = useState('');
  const [issueRecent, setIssueRecent] = useState<string[]>([]);
  const [issueExample, setIssueExample] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const searchParam = search.trim() || undefined;

      if (viewMode === 'columns') {
        const [quoRes, invRes] = await Promise.all([
          getDocuments({
            page: quoPage,
            pageSize: PAGE_SIZE,
            search: searchParam,
            status,
            company,
            docType: 'QUOTATION',
            invoiceFilter: quoInvoiceFilter,
          }),
          getDocuments({
            page: invPage,
            pageSize: PAGE_SIZE,
            search: searchParam,
            status,
            company,
            docType: 'INVOICE',
          }),
        ]);
        setQuoRows(quoRes.rows);
        setQuoTotal(quoRes.total);
        setInvRows(invRes.rows);
        setInvTotal(invRes.total);
      } else {
        const res = await getDocuments({
          page: tablePage,
          pageSize: PAGE_SIZE,
          search: searchParam,
          status,
          company,
        });
        setTableRows(res.rows);
        setTableTotal(res.total);
      }
    } catch (e) {
      console.error(e);
      toast.error('Gagal memuat arsip dokumen.');
    } finally {
      setLoading(false);
    }
  }, [viewMode, quoPage, invPage, tablePage, search, status, company, quoInvoiceFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reset pages on search/filter changes
  useEffect(() => {
    setQuoPage(0);
    setInvPage(0);
    setTablePage(0);
  }, [search, status, company, quoInvoiceFilter]);

  const openIssue = async (row: DocumentListRow) => {
    setBusyId(row.id);
    try {
      const ctx = await getNumberContext(row.seriesId ?? '');
      setIssueTarget(row);
      setIssueNumber(ctx.suggestion ? String(ctx.suggestion) : '');
      setIssueRecent(ctx.recent);
      setIssueExample(ctx.example);
    } catch {
      toast.error('Gagal memuat konteks nomor.');
    } finally {
      setBusyId(null);
    }
  };

  const confirmIssue = async () => {
    if (!issueTarget) return;
    setBusyId(issueTarget.id);
    try {
      const res = await issueDocument(issueTarget.id, issueNumber);
      if (!res.success) {
        toast.error(res.error ?? 'Gagal menerbitkan');
        return;
      }
      toast.success(`Nomor ${res.number} dibuat`);
      setIssueTarget(null);
      loadData();
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (id: string, number: string | null) => {
    if (
      !confirm(
        `Batalkan dokumen ${number ?? '(tanpa nomor)'}?\n\n` +
          'Nomornya tetap dipakai dan tidak akan didaur ulang. Ini disengaja: ' +
          'lubang di urutan nomor bisa dijelaskan, nomor yang dipakai dua kali tidak bisa.',
      )
    )
      return;

    setBusyId(id);
    try {
      const res = await cancelDocument(id);
      if (!res.success) {
        toast.error(res.error ?? 'Gagal membatalkan');
        return;
      }
      toast.success('Dokumen dibatalkan');
      loadData();
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string, number: string | null) => {
    if (
      !confirm(
        `HAPUS PERMANEN dokumen ${number ?? '(tanpa nomor)'}?\n\n` +
          'Nomor ini akan hilang dari arsip selamanya, dan nomor berikutnya tidak ' +
          'akan mengisinya. Ini untuk membersihkan dokumen tes - dokumen yang sudah ' +
          'terbit sebaiknya dibatalkan, bukan dihapus.',
      )
    )
      return;

    setBusyId(id);
    try {
      const res = await deleteDocument(id);
      if (!res.success) {
        toast.error(res.error ?? 'Gagal menghapus');
        return;
      }
      toast.success('Dokumen dihapus');
      loadData();
    } finally {
      setBusyId(null);
    }
  };

  const renderCardActions = (r: DocumentListRow) => (
    <div className="flex items-center gap-1">
      {r.status === 'DRAFT' && (
        <button
          onClick={() => router.push(`/documents/${r.id}/edit`)}
          title="Edit draft"
          className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        onClick={() => router.push(`/documents/${r.id}/print`)}
        title="Lihat hasil cetak"
        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
      >
        <Printer className="w-3.5 h-3.5" />
      </button>
      {r.status === 'DRAFT' && (
        <button
          onClick={() => openIssue(r)}
          disabled={busyId === r.id}
          title="Terbitkan - kunci dokumen dan beri nomor"
          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition disabled:opacity-40"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      )}
      {r.status === 'ISSUED' && (
        <button
          onClick={() => router.push(`/documents/${r.id}`)}
          title="Buka detail"
          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
        >
          <FileCheck2 className="w-3.5 h-3.5" />
        </button>
      )}
      {r.status !== 'CANCELLED' && r.status !== 'DRAFT' && (
        <button
          onClick={() => handleCancel(r.id, r.number)}
          disabled={busyId === r.id}
          title="Batalkan - nomor tetap dipakai"
          className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition disabled:opacity-40"
        >
          <Ban className="w-3.5 h-3.5" />
        </button>
      )}
      {isLord && (
        <button
          onClick={() => handleDelete(r.id, r.number)}
          disabled={busyId === r.id}
          title="Hapus permanen (khusus lord)"
          className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition disabled:opacity-40"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );

  const quoTotalPages = Math.ceil(quoTotal / PAGE_SIZE) || 1;
  const invTotalPages = Math.ceil(invTotal / PAGE_SIZE) || 1;
  const tableTotalPages = Math.ceil(tableTotal / PAGE_SIZE) || 1;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      <header className="py-4 md:h-20 bg-white border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between px-4 md:px-8 shrink-0 z-10 shadow-sm gap-4">
        <div className="flex flex-col shrink-0">
          <h1 className="text-lg md:text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <span className="w-2 h-5 md:h-6 bg-indigo-600 rounded-full" />
            Quotation &amp; Invoice
          </h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
            Arsip &amp; Pemantauan Dokumen Klien
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Search */}
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nomor atau klien..."
              className="pl-9 pr-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all w-full md:w-52"
            />
          </div>

          {/* Status Filter */}
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

          {/* Company Filter */}
          <select
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none"
          >
            <option value="ALL">Semua perusahaan</option>
            <option value="TNT">Thick and Thin</option>
            <option value="HYPE">HYPE</option>
          </select>

          {/* View Mode Switcher */}
          <div className="flex items-center bg-slate-100 border border-slate-200 rounded-xl p-0.5">
            <button
              onClick={() => setViewMode('columns')}
              title="Tampilan 2 Kolom (Quotation & Invoice)"
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition',
                viewMode === 'columns'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800',
              )}
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">2 Kolom</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              title="Tampilan Tabel Lengkap"
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition',
                viewMode === 'table'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800',
              )}
            >
              <Table2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Tabel</span>
            </button>
          </div>

          {/* Buat Dokumen Button */}
          <button
            onClick={() => router.push('/documents/new')}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-black rounded-xl transition shadow-lg shadow-indigo-500/20 uppercase tracking-widest"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden md:inline">Buat</span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 md:p-6 custom-scrollbar">
        {viewMode === 'columns' ? (
          /* ========================================================================= */
          /* 2-COLUMN VIEW (LEFT: QUOTATION, RIGHT: INVOICE)                           */
          /* ========================================================================= */
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
            {/* --------------------------------------------------------------------- */}
            {/* LEFT COLUMN: QUOTATION                                                */}
            {/* --------------------------------------------------------------------- */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              {/* Column Header */}
              <div className="p-4 md:p-5 border-b border-slate-100 bg-gradient-to-r from-indigo-50/50 to-white flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/20">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                        Quotation
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">
                          {quoTotal}
                        </span>
                      </h2>
                      <p className="text-[10px] text-slate-400 font-semibold">
                        Penawaran harga &amp; paket ke klien
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => router.push('/documents/new')}
                    className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-black rounded-lg transition"
                  >
                    <Plus className="w-3 h-3" />
                    Baru
                  </button>
                </div>

                {/* Status Tabs for Quotation */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[10px] font-bold">
                  <button
                    onClick={() => setQuoInvoiceFilter('ALL')}
                    className={cn(
                      'px-2.5 py-1 rounded-lg transition whitespace-nowrap',
                      quoInvoiceFilter === 'ALL'
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                    )}
                  >
                    Semua
                  </button>
                  <button
                    onClick={() => setQuoInvoiceFilter('WITHOUT_INVOICE')}
                    className={cn(
                      'flex items-center gap-1 px-2.5 py-1 rounded-lg transition whitespace-nowrap border',
                      quoInvoiceFilter === 'WITHOUT_INVOICE'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                        : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
                    )}
                  >
                    <AlertCircle className="w-3 h-3" />
                    Belum Ada Invoice
                  </button>
                  <button
                    onClick={() => setQuoInvoiceFilter('WITH_INVOICE')}
                    className={cn(
                      'flex items-center gap-1 px-2.5 py-1 rounded-lg transition whitespace-nowrap border',
                      quoInvoiceFilter === 'WITH_INVOICE'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
                    )}
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    Sudah Ada Invoice
                  </button>
                </div>
              </div>

              {/* Quotation List */}
              <div className="p-4 space-y-3 divide-y divide-slate-100">
                {quoRows.map((r) => (
                  <div
                    key={r.id}
                    className="pt-3 first:pt-0 space-y-2.5 group transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-black text-slate-800 tabular-nums">
                            {r.number ?? (
                              <span className="text-slate-400 italic font-normal">
                                DRAFT (belum bernomor)
                              </span>
                            )}
                          </span>
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border inline-block',
                              STATUS_TONE[r.status] ?? STATUS_TONE.DRAFT,
                            )}
                          >
                            {STATUS_LABEL[r.status] ?? r.status}
                          </span>
                          <span className="text-[9px] font-bold text-slate-400 uppercase">
                            {r.company}
                          </span>
                        </div>

                        <button
                          onClick={() => router.push(`/documents/${r.id}`)}
                          className="text-sm font-black text-slate-900 hover:text-indigo-600 text-left mt-1 block truncate max-w-sm"
                        >
                          {r.clientName}
                        </button>

                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {r.itemCount} item &middot; oleh {r.createdByName ?? '-'} &middot;{' '}
                          {r.issueDate
                            ? new Date(r.issueDate).toLocaleDateString('id-ID', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })
                            : '-'}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-sm font-black text-slate-900 tabular-nums">
                          {rupiah(r.grandTotal)}
                        </div>
                        <div className="mt-1 flex justify-end">
                          {renderCardActions(r)}
                        </div>
                      </div>
                    </div>

                    {/* Invoice Tracking Status Banner */}
                    <div>
                      {r.hasInvoice ? (
                        <div className="flex items-center justify-between text-[10.5px] font-bold text-emerald-700 bg-emerald-50/90 border border-emerald-200 px-3 py-1.5 rounded-xl">
                          <span className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            Sudah ada Invoice ({r.invoiceCount})
                          </span>
                          <span className="text-[9px] text-emerald-600 uppercase tracking-widest font-black">
                            Tersinkron
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-amber-50/90 border border-amber-200">
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-800">
                            <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span>Belum ada invoice</span>
                          </div>
                          <button
                            onClick={() => router.push(`/documents/new?fromQuotationId=${r.id}`)}
                            title="Buat invoice langsung dengan data klien & item quotation ini"
                            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition shadow-sm flex items-center gap-1"
                          >
                            <Plus className="w-3 h-3" />
                            Buat Invoice
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {!loading && quoRows.length === 0 && (
                  <div className="py-16 text-center">
                    <FileText className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                      Tidak ada quotation
                    </p>
                  </div>
                )}
              </div>

              {/* Quotation Pagination */}
              {quoTotal > PAGE_SIZE && (
                <div className="p-3 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <span className="text-[10px] font-bold text-slate-400">
                    Hal {quoPage + 1} dari {quoTotalPages} ({quoTotal} doc)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setQuoPage((p) => Math.max(0, p - 1))}
                      disabled={quoPage === 0}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50"
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setQuoPage((p) => Math.min(quoTotalPages - 1, p + 1))}
                      disabled={quoPage >= quoTotalPages - 1}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* --------------------------------------------------------------------- */}
            {/* RIGHT COLUMN: INVOICE                                                 */}
            {/* --------------------------------------------------------------------- */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              {/* Column Header */}
              <div className="p-4 md:p-5 border-b border-slate-100 bg-gradient-to-r from-emerald-50/50 to-white flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/20">
                    <Receipt className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      Invoice
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                        {invTotal}
                      </span>
                    </h2>
                    <p className="text-[10px] text-slate-400 font-semibold">
                      Tagihan resmi &amp; penagihan pembayaran
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => router.push('/documents/new')}
                  className="flex items-center gap-1 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-black rounded-lg transition"
                >
                  <Plus className="w-3 h-3" />
                  Baru
                </button>
              </div>

              {/* Invoice List */}
              <div className="p-4 space-y-3 divide-y divide-slate-100">
                {invRows.map((r) => (
                  <div
                    key={r.id}
                    className="pt-3 first:pt-0 space-y-2 group transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-black text-slate-800 tabular-nums">
                            {r.number ?? (
                              <span className="text-slate-400 italic font-normal">
                                DRAFT (belum bernomor)
                              </span>
                            )}
                          </span>
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border inline-block',
                              STATUS_TONE[r.status] ?? STATUS_TONE.DRAFT,
                            )}
                          >
                            {STATUS_LABEL[r.status] ?? r.status}
                          </span>
                          <span className="text-[9px] font-bold text-slate-400 uppercase">
                            {r.company}
                          </span>
                        </div>

                        <button
                          onClick={() => router.push(`/documents/${r.id}`)}
                          className="text-sm font-black text-slate-900 hover:text-indigo-600 text-left mt-1 block truncate max-w-sm"
                        >
                          {r.clientName}
                        </button>

                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {r.itemCount} item &middot; oleh {r.createdByName ?? '-'} &middot;{' '}
                          {r.issueDate
                            ? new Date(r.issueDate).toLocaleDateString('id-ID', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })
                            : '-'}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-sm font-black text-slate-900 tabular-nums">
                          {rupiah(r.grandTotal)}
                        </div>
                        <div className="mt-1 flex justify-end">
                          {renderCardActions(r)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {!loading && invRows.length === 0 && (
                  <div className="py-16 text-center">
                    <Receipt className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                      Tidak ada invoice
                    </p>
                  </div>
                )}
              </div>

              {/* Invoice Pagination */}
              {invTotal > PAGE_SIZE && (
                <div className="p-3 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <span className="text-[10px] font-bold text-slate-400">
                    Hal {invPage + 1} dari {invTotalPages} ({invTotal} doc)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setInvPage((p) => Math.max(0, p - 1))}
                      disabled={invPage === 0}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50"
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setInvPage((p) => Math.min(invTotalPages - 1, p + 1))}
                      disabled={invPage >= invTotalPages - 1}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ========================================================================= */
          /* TABLE VIEW (FULL ARCHIVE)                                                 */
          /* ========================================================================= */
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left">
                <thead>
                  <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-200">
                    <th className="px-5 py-3">Nomor</th>
                    <th className="px-5 py-3">Klien</th>
                    <th className="px-5 py-3">Perusahaan &amp; Jenis</th>
                    <th className="px-5 py-3">Status Invoice</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Tanggal</th>
                    <th className="px-5 py-3 text-right">Total</th>
                    <th className="px-5 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {tableRows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/70 transition">
                      <td className="px-5 py-3">
                        <span className="text-xs font-black text-slate-800 tabular-nums">
                          {r.number ?? (
                            <span className="text-slate-300 italic font-normal">
                              belum ada
                            </span>
                          )}
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
                          {r.company} &middot;{' '}
                          {r.docType === 'QUOTATION' ? 'QUOTATION' : 'INVOICE'}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {r.docType === 'QUOTATION' ? (
                          r.hasInvoice ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Sudah Ada ({r.invoiceCount})
                            </span>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                <AlertCircle className="w-3 h-3 text-amber-600" />
                                Belum Ada
                              </span>
                              <button
                                onClick={() =>
                                  router.push(`/documents/new?fromQuotationId=${r.id}`)
                                }
                                title="Buat invoice dari quotation ini"
                                className="px-2 py-0.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-[9px] font-black uppercase transition"
                              >
                                + Buat
                              </button>
                            </div>
                          )
                        ) : (
                          <span className="text-[10px] text-slate-400 font-medium">
                            —
                          </span>
                        )}
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
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          {renderCardActions(r)}
                        </div>
                      </td>
                    </tr>
                  ))}

                  {!loading && tableRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-5 py-20 text-center">
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

            {tableTotal > PAGE_SIZE && (
              <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400">
                  Halaman {tablePage + 1} dari {tableTotalPages} ({tableTotal} dokumen)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setTablePage((p) => Math.max(0, p - 1))}
                    disabled={tablePage === 0}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-[10px] font-bold disabled:opacity-50 hover:bg-slate-50"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() =>
                      setTablePage((p) => Math.min(tableTotalPages - 1, p + 1))
                    }
                    disabled={tablePage >= tableTotalPages - 1}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-[10px] font-bold disabled:opacity-50 hover:bg-slate-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Issue Document Modal */}
      {issueTarget && (
        <div className="fixed inset-0 z-[60] bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                <Send className="w-4 h-4 text-emerald-600" />
                Terbitkan dokumen
              </h3>
              <p className="text-[11px] text-slate-500 mt-1">
                {issueTarget.clientName} &middot; {issueTarget.company}{' '}
                {issueTarget.docType === 'QUOTATION' ? 'QUO' : 'INV'}
              </p>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">
                  Nomor dokumen
                </label>
                <input
                  type="text"
                  value={issueNumber}
                  onChange={(e) => setIssueNumber(e.target.value)}
                  placeholder="mis. 038/QUO-TNT/SA/IX/26"
                  autoFocus
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-black text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-300 outline-none"
                />
                <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                  Nomor diketik manual. Aturan penomoran kantor belum seragam, jadi sistem
                  tidak menebak - nomor yang salah bisa terlanjur tercetak dan dikirim
                  ke klien.
                </p>
              </div>

              {issueExample && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    Contoh dari dokumen yang sudah keluar
                  </p>
                  <p className="text-xs font-black text-slate-700 mt-0.5">{issueExample}</p>
                </div>
              )}

              {issueRecent.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                    Nomor terakhir di seri ini
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {issueRecent.map((n) => (
                      <span
                        key={n}
                        className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-600 tabular-nums"
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  <span className="font-black">Setelah terbit, dokumen tidak bisa diedit.</span>{' '}
                  Nomor ini akan keluar ke klien. Kalau ada yang salah, batalkan lalu buat
                  nomor baru - jangan diedit, karena isi yang lama sudah pernah dibaca orang.
                </p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setIssueTarget(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[11px] font-black uppercase tracking-widest transition"
              >
                Batal
              </button>
              <button
                onClick={confirmIssue}
                disabled={!issueNumber.trim() || busyId === issueTarget.id}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl text-[11px] font-black uppercase tracking-widest transition shadow-lg shadow-emerald-500/20"
              >
                Terbitkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
