'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Ban, Send, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  cancelDocument,
  deleteDocument,
  getDocument,
  getNumberContext,
  issueDocument,
} from '@/app/actions/document-actions';
import type { PreviewDoc } from './DocumentPreview';
import { PreviewPane } from './PreviewPane';
import type { UserProfile } from '@/types';
import { cn } from '@/lib/utils';

const rupiah = (n: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);

export default function DocumentDetailClient({
  id,
  user,
}: {
  id: string;
  user: UserProfile;
}) {
  const router = useRouter();
  const isLord = user.role === 'lord';
  const [isPending, startTransition] = useTransition();

  const [doc, setDoc] = useState<(Awaited<ReturnType<typeof getDocument>>) | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [issueOpen, setIssueOpen] = useState(false);
  const [issueNumber, setIssueNumber] = useState('');
  const [issueRecent, setIssueRecent] = useState<string[]>([]);
  const [issueExample, setIssueExample] = useState<string | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getDocument(id);
      if (!d) {
        toast.error('Dokumen tidak ditemukan');
        router.push('/documents');
        return;
      }
      setDoc(d);
    } catch {
      toast.error('Gagal memuat dokumen.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const openIssue = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      const ctx = await getNumberContext(doc.seriesId);
      setIssueNumber(ctx.suggestion ? String(ctx.suggestion) : '');
      setIssueRecent(ctx.recent);
      setIssueExample(ctx.example);
      setIssueOpen(true);
    } catch {
      toast.error('Gagal memuat konteks nomor.');
    } finally {
      setBusy(false);
    }
  };

  const confirmIssue = () => {
    if (!doc) return;
    setBusy(true);
    startTransition(async () => {
      const res = await issueDocument(doc.id, issueNumber);
      setBusy(false);
      if (!res.success) {
        toast.error(res.error ?? 'Gagal menerbitkan');
        return;
      }
      toast.success(`Nomor ${res.number} dibuat`);
      setIssueOpen(false);
      load();
    });
  };

  const handleCancel = () => {
    if (!doc) return;
    if (!confirm(
      'Batalkan dokumen ini?\n\nNomornya tetap dipakai dan tidak akan didaur ulang. ' +
      'Ini disengaja: lubang di urutan nomor bisa dijelaskan, nomor yang dipakai dua kali tidak.',
    )) return;
    setBusy(true);
    startTransition(async () => {
      const res = await cancelDocument(doc.id);
      setBusy(false);
      if (!res.success) {
        toast.error(res.error ?? 'Gagal membatalkan');
        return;
      }
      toast.success('Dokumen dibatalkan');
      load();
    });
  };

  const handleDelete = () => {
    if (!doc) return;
    if (!confirm(
      'HAPUS PERMANEN dokumen ini?\n\nNomornya hilang dari arsip selamanya dan tidak akan ' +
      'diisi nomor berikutnya. Ini untuk membersihkan dokumen tes. Kalau sudah terbit, ' +
      'sebaiknya dibatalkan saja.',
    )) return;
    setBusy(true);
    startTransition(async () => {
      const res = await deleteDocument(doc.id);
      setBusy(false);
      if (!res.success) {
        toast.error(res.error ?? 'Gagal menghapus');
        return;
      }
      toast.success('Dokumen dihapus');
      router.push('/documents');
    });
  };

  if (loading || !doc) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  const preview: PreviewDoc = {
    company: doc.company,
    docType: doc.docType,
    number: doc.number,
    clientName: doc.clientName,
    issueDate: doc.issueDate,
    period: doc.period,
    items: doc.items.map((i) => ({
      title: i.title,
      description: i.description,
      period: i.period,
      price: i.price,
    })),
    subtotal: doc.subtotal,
    taxRate: doc.taxRate,
    taxLabel: doc.taxLabel,
    taxAmount: doc.taxAmount,
    grandTotal: doc.grandTotal,
    terms: doc.terms,
    approverName: doc.approverName,
    bankName: doc.bankName,
    bankAccountName: doc.bankAccountName,
    bankAccountNumber: doc.bankAccountNumber,
    bankBranch: doc.bankBranch,
    signatoryName: doc.signatoryName,
    signatoryTitle: doc.signatoryTitle,
  };

  const isDraft = doc.status === 'DRAFT';
  const isCancelled = doc.status === 'CANCELLED';

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      <header className="py-4 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 shrink-0 z-10 shadow-sm gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.push('/documents')}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition shrink-0"
            title="Kembali ke arsip"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-2 truncate">
              <span className="truncate">{doc.clientName}</span>
              <span
                className={cn(
                  'px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border shrink-0',
                  isDraft && 'bg-slate-100 text-slate-600 border-slate-200',
                  doc.status === 'ISSUED' && 'bg-emerald-50 text-emerald-700 border-emerald-200',
                  isCancelled && 'bg-rose-50 text-rose-600 border-rose-200',
                )}
              >
                {doc.status === 'ISSUED' ? 'TERBIT' : doc.status === 'DRAFT' ? 'DRAFT' : 'DIBATALKAN'}
              </span>
            </h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
              {doc.number ?? 'belum ada nomor'} &middot; {doc.company}{' '}
              {doc.docType === 'QUOTATION' ? 'Quotation' : 'Invoice'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {doc.number && (
            <button
              onClick={() => router.push(`/documents/${doc.id}/print`)}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[11px] font-black uppercase tracking-widest transition flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" />
              <span className="hidden md:inline">Print</span>
            </button>
          )}
          {isDraft && (
            <button
              onClick={openIssue}
              disabled={busy || isPending}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl text-[11px] font-black uppercase tracking-widest transition shadow-lg shadow-emerald-500/20 flex items-center gap-1.5"
            >
              <Send className="w-4 h-4" />
              Terbitkan
            </button>
          )}
          {!isDraft && !isCancelled && (
            <button
              onClick={handleCancel}
              disabled={busy || isPending}
              className="px-3 py-2 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-xl text-[11px] font-black uppercase tracking-widest transition flex items-center gap-1.5"
            >
              <Ban className="w-4 h-4" />
              Batalkan
            </button>
          )}
          {isLord && (
            <button
              onClick={handleDelete}
              disabled={busy || isPending}
              className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl transition disabled:opacity-40"
              title="Hapus permanen (khusus lord)"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Same zoom and drag affordance as the form's preview. Reading a stored
          document is the whole point of this page, and at a fixed 0.8 scale the
          9px body text was not readable. */}
      <PreviewPane
        doc={preview}
        summary={`${preview.items.length} item · ${rupiah(preview.grandTotal)}`}
        expanded={previewExpanded}
        onToggleExpanded={() => setPreviewExpanded((v) => !v)}
        className="flex-1 min-h-0 border-l-0"
      />

      {issueOpen && (
        <div className="fixed inset-0 z-[60] bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                <Send className="w-4 h-4 text-emerald-600" />
                Terbitkan dokumen
              </h3>
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
                  autoFocus
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-black text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-300 outline-none"
                />
              </div>
              {issueExample && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    Contoh
                  </p>
                  <p className="text-xs font-black text-slate-700 mt-0.5">{issueExample}</p>
                </div>
              )}
              {issueRecent.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                    Nomor terakhir
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {issueRecent.map((n) => (
                      <span key={n} className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-600 tabular-nums">
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  <span className="font-black">Setelah terbit, tidak bisa diedit.</span> Nomor ini
                  akan keluar ke klien. Kalau salah, batalkan lalu buat nomor baru.
                </p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                onClick={() => setIssueOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[11px] font-black uppercase tracking-widest"
              >
                Batal
              </button>
              <button
                onClick={confirmIssue}
                disabled={!issueNumber.trim() || busy}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl text-[11px] font-black uppercase tracking-widest"
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
