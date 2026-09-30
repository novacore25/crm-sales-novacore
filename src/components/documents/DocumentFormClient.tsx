'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Save, Trash2, Eye } from 'lucide-react';
import { toast } from 'sonner';
import {
  createDocument,
  getBankAccounts,
  getDocumentSeries,
  getSignatories,
} from '@/app/actions/document-actions';
import { computeTotals } from '@/lib/document-totals';
import { ComboBox } from './ComboBox';
import { DocumentPreview, type PreviewDoc } from './DocumentPreview';
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

export default function DocumentFormClient() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [series, setSeries] = useState<
    { id: string; label: string | null; company: string; docType: string }[]
  >([]);
  const [seriesId, setSeriesId] = useState('');
  const [clientName, setClientName] = useState('');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [period, setPeriod] = useState('');
  const [taxRate, setTaxRate] = useState('');
  const [taxLabel, setTaxLabel] = useState('PPN');
  const [terms, setTerms] = useState('');
  const [approverName, setApproverName] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankBranch, setBankBranch] = useState('');
  const [signatoryName, setSignatoryName] = useState('');
  const [signatoryTitle, setSignatoryTitle] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([{ ...EMPTY_ITEM }]);
  const [tab, setTab] = useState<'form' | 'preview'>('form');
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
      const res = await createDocument({
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
      });
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
              Buat Dokumen
            </h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Tersimpan sebagai DRAFT &middot; belum ada nomor
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
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

        {/* live preview */}
        <div className={cn('lg:w-[46%] xl:w-[42%] bg-slate-200 border-l border-slate-300 overflow-auto p-4 md:p-6', tab === 'form' && 'hidden lg:block')}>
          <div className="sticky top-0 -mx-1 px-1 pb-3 bg-slate-200/90 backdrop-blur z-10">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                <Eye className="w-3 h-3" />
                Preview langsung
              </span>
              <span className="text-[10px] font-bold text-slate-400 tabular-nums">
                {preview.items.length} item &middot; {rupiah(preview.grandTotal)}
              </span>
            </div>
          </div>

          {/* A4 at 0.62 scale: 210mm * 0.62 ≈ 130px wide, close enough to a
              real page that the layout can be judged, small enough to sit
              beside the form. The print route renders the same component at
              full size. */}
          <div className="mx-auto origin-top-left scale-[0.62] sm:scale-[0.7] lg:scale-[0.62] w-[794px]">
            <div className="shadow-xl ring-1 ring-slate-300 bg-white min-h-[1123px]">
              <DocumentPreview doc={preview} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
