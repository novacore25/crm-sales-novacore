'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Save, Trash2, Eye, Printer } from 'lucide-react';
import { toast } from 'sonner';
import {
  createDocument,
  getBankAccounts,
  getDocumentSeries,
  getSignatories,
  updateDocument,
} from '@/app/actions/document-actions';
import { computeTotals } from '@/lib/document-totals';
import { ComboBox } from './ComboBox';
import type { PreviewDoc } from './DocumentPreview';
import { PreviewPane } from './PreviewPane';
import { cn } from '@/lib/utils';

interface ItemDraft {
  title: string;
  description: string;
  period: string;
  price: string;
}

const EMPTY_ITEM: ItemDraft = { title: '', description: '', period: '', price: '' };

const rupiah = (n: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);

/**
 * The document as it comes back from the server, in the shape the form needs.
 * Kept separate from the DB row so the form does not have to know about
 * numeric-string columns.
 */
export interface DocumentFormSeed {
  id: string;
  seriesId: string;
  clientName: string;
  issueDate: string | null;
  period: string | null;
  taxRate: string | null;
  taxLabel: string | null;
  terms: string | null;
  approverName: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankBranch: string | null;
  signatoryName: string | null;
  signatoryTitle: string | null;
  items: { title: string; description: string; period: string; price: string }[];
}

export default function DocumentFormClient({ seed }: { seed?: DocumentFormSeed }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEdit = !!seed;

  const [series, setSeries] = useState<
    { id: string; label: string | null; company: string; docType: string }[]
  >([]);
  const [seriesId, setSeriesId] = useState(seed?.seriesId ?? '');
  const [clientName, setClientName] = useState(seed?.clientName ?? '');
  const [issueDate, setIssueDate] = useState(
    seed?.issueDate ?? new Date().toISOString().slice(0, 10),
  );
  const [period, setPeriod] = useState(seed?.period ?? '');
  const [taxRate, setTaxRate] = useState(seed?.taxRate ?? '');
  const [taxLabel, setTaxLabel] = useState(seed?.taxLabel ?? 'PPN');
  const [terms, setTerms] = useState(seed?.terms ?? '');
  const [approverName, setApproverName] = useState(seed?.approverName ?? '');
  const [bankName, setBankName] = useState(seed?.bankName ?? '');
  const [bankAccountName, setBankAccountName] = useState(seed?.bankAccountName ?? '');
  const [bankAccountNumber, setBankAccountNumber] = useState(seed?.bankAccountNumber ?? '');
  const [bankBranch, setBankBranch] = useState(seed?.bankBranch ?? '');
  const [signatoryName, setSignatoryName] = useState(seed?.signatoryName ?? '');
  const [signatoryTitle, setSignatoryTitle] = useState(seed?.signatoryTitle ?? '');
  const [items, setItems] = useState<ItemDraft[]>(
    seed?.items.length ? seed.items : [{ ...EMPTY_ITEM }],
  );
  const [tab, setTab] = useState<'form' | 'preview'>('form');
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [bankOptions, setBankOptions] = useState<
    { id: string; bankName: string | null; accountName: string; accountNumber: string | null; branch: string | null }[]
  >([]);
  const [signatoryOptions, setSignatoryOptions] = useState<
    { id: string; name: string; title: string | null }[]
  >([]);

  useEffect(() => {
    getDocumentSeries()
      .then((rows) => {
        setSeries(rows);
        if (rows.length > 0) setSeriesId(rows[0].id);
      })
      .catch(() => toast.error('Gagal memuat seri dokumen.'));
  }, []);

  const current = series.find((s) => s.id === seriesId);

  /**
   * Bank accounts and signatories, loaded per company.
   *
   * Reloading on company change is deliberate and not an optimisation. These
   * lists are kept separate so a HYPE document can never be given the TNT
   * account; showing a stale list from the previous company would reintroduce
   * exactly that mistake.
   */
  useEffect(() => {
    if (!current) {
      setBankOptions([]);
      setSignatoryOptions([]);
      return;
    }
    let cancelled = false;
    Promise.all([getBankAccounts(current.company), getSignatories(current.company)])
      .then(([banks, sigs]) => {
        if (cancelled) return;
        setBankOptions(banks);
        setSignatoryOptions(sigs);
      })
      .catch(() => {
        if (!cancelled) toast.error('Gagal memuat daftar rekening.');
      });
    return () => {
      cancelled = true;
    };
  }, [current]);

  // The SAME function the server action uses. Computing this inline in the
  // browser is how a preview starts promising a total the saved document does
  // not deliver - the two implementations drift on rounding, and nobody notices
  // until a client adds up the invoice.
  const totals = useMemo(
    () =>
      computeTotals(
        items.map((i) => ({ price: Number(i.price) || 0 })),
        taxRate === '' ? null : Number(taxRate),
      ),
    [items, taxRate],
  );

  // The preview reads from exactly the same numbers the action will submit, so
  // what is on screen is what gets stored. Two separate calculations is how a
  // preview drifts from the printed document.
  const preview: PreviewDoc = useMemo(
    () => ({
      company: current?.company ?? 'TNT',
      docType: current?.docType ?? 'INVOICE',
      number: null,
      clientName,
      issueDate,
      period,
      items: items
        .filter((i) => i.title.trim())
        .map((i) => ({
          title: i.title,
          description: i.description,
          period: i.period,
          price: Number(i.price) || 0,
        })),
      subtotal: totals.subtotal,
      taxRate: taxRate === '' ? null : Number(taxRate),
      taxLabel: taxLabel || null,
      taxAmount: totals.taxAmount,
      grandTotal: totals.grandTotal,
      terms,
      approverName,
      bankName,
      bankAccountName,
      bankAccountNumber,
      bankBranch,
      signatoryName,
      signatoryTitle,
    }),
    [
      current, clientName, issueDate, period, items, totals,
      taxRate, taxLabel, terms, approverName, bankName,
      bankAccountName, bankAccountNumber, bankBranch, signatoryName, signatoryTitle,
    ],
  );

  const setItem = useCallback((idx: number, patch: Partial<ItemDraft>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }, []);

  const addItem = useCallback(() => setItems((p) => [...p, { ...EMPTY_ITEM }]), []);

  const removeItem = useCallback((idx: number) => {
    // Always leave one row. An empty form with no row cannot be saved and the
    // preview would lose its shape, so the last row just gets cleared.
    setItems((p) => (p.length === 1 ? [{ ...EMPTY_ITEM }] : p.filter((_, i) => i !== idx)));
  }, []);

  const canSave = clientName.trim() !== '' && items.some((i) => i.title.trim());

  const handleSave = () => {
    if (!canSave) {
      toast.error('Nama klien dan minimal satu item wajib diisi.');
      return;
    }
    const clean = items.filter((i) => i.title.trim());
    startTransition(async () => {
      const payload = {
        seriesId,
        clientName: clientName.trim(),
        product: null,
        issueDate: issueDate || null,
        period: period || null,
        taxRate: taxRate === '' ? null : Number(taxRate),
        taxLabel: taxLabel || null,
        terms: terms || null,
        numberSegment: null,
        approverName: approverName || null,
        bankName: bankName || null,
        bankAccountName: bankAccountName || null,
        bankAccountNumber: bankAccountNumber || null,
        bankBranch: bankBranch || null,
        signatoryName: signatoryName || null,
        signatoryTitle: signatoryTitle || null,
        items: clean.map((i) => ({
          title: i.title.trim(),
          description: i.description || null,
          period: i.period || null,
          price: Number(i.price) || 0,
        })),
      };

      // updateDocument refuses anything that is not a DRAFT, so an edit that lost
      // a race with someone publishing the document fails loudly instead of
      // silently rewriting an issued one.
      if (isEdit && seed) {
        const res = await updateDocument(seed.id, payload);
        if (!res.success) {
          toast.error(res.error ?? 'Gagal menyimpan perubahan');
          return;
        }
        toast.success('DRAFT diperbarui');
        router.push(`/documents/${seed.id}`);
        router.refresh();
        return;
      }

      const res = await createDocument(payload);
      if (!res.success || !res.id) {
        toast.error(res.error ?? 'Gagal menyimpan dokumen');
        return;
      }
      toast.success('DRAFT tersimpan');
      router.push(`/documents/${res.id}`);
    });
  };

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
            <h1 className="text-lg font-black text-slate-900 tracking-tight truncate">
              {isEdit ? 'Edit Draft' : 'Buat Dokumen'}
            </h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              {isEdit
                ? 'Perubahan langsung tersimpan ke draft ini'
                : 'Tersimpan sebagai DRAFT · belum ada nomor'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Printable before publishing, so the layout can be checked while the
              document is still cheap to change. */}
          {isEdit && seed && (
            <button
              onClick={() => router.push(`/documents/${seed.id}/print`)}
              title="Buka tampilan cetak, lalu Save as PDF"
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[11px] font-black uppercase tracking-widest transition flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" />
              <span className="hidden md:inline">Print</span>
            </button>
          )}
          <div className="hidden md:flex rounded-xl bg-slate-100 p-1">
            <button
              onClick={() => setTab('form')}
              className={cn(
                'px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition',
                tab === 'form' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
              )}
            >
              Isi
            </button>
            <button
              onClick={() => setTab('preview')}
              className={cn(
                'px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition flex items-center gap-1.5',
                tab === 'preview' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
              )}
            >
              <Eye className="w-3 h-3" />
              Preview
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={!canSave || isPending}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl text-[11px] font-black uppercase tracking-widest transition shadow-lg shadow-indigo-500/20 flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            Simpan
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
        {/* form */}
        <div className={cn('flex-1 overflow-auto p-4 md:p-6 space-y-5', tab === 'preview' && 'hidden lg:block')}>
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Dasar
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Jenis dokumen
                </span>
                <select
                  value={seriesId}
                  onChange={(e) => setSeriesId(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {series.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label ?? `${s.company} - ${s.docType}`}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Menentukan kop dan layout cetak
                </span>
              </label>

              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Tanggal dokumen
                </span>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>
            </div>

            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Nama klien (nama PT / brand)
              </span>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="mis. PT L'OREAL INDONESIA"
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Ketik persis seperti yang mau tampil di dokumen. Sering berbeda dari
                nama brand di CRM.
              </span>
            </label>
          </div>

          {/* items */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Item
              </h2>
              <button
                onClick={addItem}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-black uppercase tracking-widest transition flex items-center gap-1.5"
              >
                <Plus className="w-3 h-3" />
                Tambah
              </button>
            </div>

            {items.map((item, idx) => (
              <div key={idx} className="border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <input
                    type="text"
                    value={item.title}
                    onChange={(e) => setItem(idx, { title: e.target.value })}
                    placeholder="Nama paket, mis. Affiliate Booster"
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-xs font-black text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    onClick={() => removeItem(idx)}
                    className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition shrink-0"
                    title="Hapus item"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <textarea
                  value={item.description}
                  onChange={(e) => setItem(idx, { description: e.target.value })}
                  rows={5}
                  placeholder={'Rincian, satu baris per poin:\n1.500 creators (VT Concept & Quantity)\nUpload 1.500 VT with Yellow Cart\nTier Creator'}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[11px] text-slate-600 outline-none focus:ring-2 focus:ring-indigo-500 leading-relaxed resize-y"
                />

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Periode
                    </span>
                    <input
                      type="text"
                      value={item.period}
                      onChange={(e) => setItem(idx, { period: e.target.value })}
                      placeholder="30 Days"
                      className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Harga
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={item.price}
                      onChange={(e) => setItem(idx, { price: e.target.value })}
                      placeholder="0"
                      className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-black text-slate-800 tabular-nums outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>

          {/* tax + terms */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Pajak &amp; Ketentuan
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Label pajak
                </span>
                <input
                  type="text"
                  value={taxLabel}
                  onChange={(e) => setTaxLabel(e.target.value)}
                  placeholder="PPN"
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Tarif (%)
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  placeholder="11"
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-black text-slate-800 tabular-nums outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Kosongkan kalau dokumen ini tidak menampilkan pajak. Quotation HYPE dan
              sebagian invoice TNT tidak menampilkannya. Persentase diisi manual karena
              aturannya belum seragam antar perusahaan.
            </p>

            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Ketentuan / catatan kaki
              </span>
              <textarea
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                rows={4}
                placeholder={'Payment 100% before the project start\nAll price above already include the KOL cost'}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-[11px] text-slate-600 outline-none focus:ring-2 focus:ring-indigo-500 leading-relaxed resize-y"
              />
            </label>
          </div>

          {/* bank + signature */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Rekening &amp; Penandatangan
            </h2>

            <p className="text-[10px] text-slate-400 leading-relaxed">
              Daftar di bawah milik{' '}
              <span className="font-black text-slate-600">{current?.company}</span> saja.
              Rekening dan penandatangan tiap perusahaan berbeda, dan salah pilih
              berarti nomor rekening yang tidak benar ikut tercetak.
            </p>

            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Rekening
              </span>
              <div className="mt-1">
                <ComboBox
                  value={bankAccountName}
                  onChange={(v) => {
                    setBankAccountName(v);
                    // Picking a known account fills the rest in, so nobody
                    // assembles a valid name with a mismatched number.
                    const hit = bankOptions.find(
                      (b) => b.accountName.toLowerCase() === v.trim().toLowerCase(),
                    );
                    if (hit) {
                      setBankName(hit.bankName ?? '');
                      setBankAccountNumber(hit.accountNumber ?? '');
                      setBankBranch(hit.branch ?? '');
                    }
                  }}
                  options={bankOptions.map((b) => ({
                    value: b.accountName,
                    label: b.accountName,
                    hint: [b.bankName, b.accountNumber, b.branch]
                      .filter(Boolean)
                      .join(' · '),
                  }))}
                  placeholder="Pilih atau ketik nama rekening"
                />
              </div>
            </label>

            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bank</span>
                <input type="text" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="BCA" className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500" />
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nomor</span>
                <input type="text" value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} placeholder="7613472888" className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-black text-slate-800 tabular-nums outline-none focus:ring-2 focus:ring-indigo-500" />
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cabang</span>
                <input type="text" value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} placeholder="KARAWACI" className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500" />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Nama penandatangan
                </span>
                <div className="mt-1">
                  <ComboBox
                    value={signatoryName}
                    onChange={(v) => {
                      setSignatoryName(v);
                      const hit = signatoryOptions.find(
                        (s) => s.name.toLowerCase() === v.trim().toLowerCase(),
                      );
                      if (hit) setSignatoryTitle(hit.title ?? '');
                    }}
                    options={signatoryOptions.map((s) => ({
                      value: s.name,
                      label: s.name,
                      hint: s.title ?? undefined,
                    }))}
                    placeholder="Pilih atau ketik nama"
                  />
                </div>
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Jabatan
                </span>
                <input type="text" value={signatoryTitle} onChange={(e) => setSignatoryTitle(e.target.value)} placeholder="DIREKTUR" className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500" />
              </label>
            </div>

            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Disetujui oleh (nama klien)
              </span>
              <input
                type="text"
                value={approverName}
                onChange={(e) => setApproverName(e.target.value)}
                placeholder="Nama orang di pihak klien"
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
          </div>
        </div>

        {/* Live preview. The pane owns its own scrolling and zoom; the form
            column only decides how much width the pane gets. */}
        <PreviewPane
          doc={preview}
          summary={`${preview.items.length} item · ${rupiah(preview.grandTotal)}`}
          expanded={previewExpanded}
          onToggleExpanded={() => setPreviewExpanded((v) => !v)}
          className={cn(
            'min-h-0',
            tab === 'form' && 'hidden lg:flex',
            previewExpanded
              ? 'lg:w-[78%] xl:w-[74%]'
              : 'lg:w-[46%] xl:w-[42%]',
          )}
        />
      </div>
    </div>
  );
}
