'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Plus,
  Save,
  Trash2,
  Eye,
  Printer,
  Bold,
  Italic,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  createDocument,
  getBankAccounts,
  getDocumentSeries,
  getNumberCodes,
  getSignatories,
  updateDocument,
} from '@/app/actions/document-actions';
import { computeTotals } from '@/lib/document-totals';
import { composeNumber, extractSegment } from '@/lib/document-number';
import { ComboBox } from './ComboBox';
import type { PreviewDoc } from './DocumentPreview';
import { PreviewPane } from './PreviewPane';
import { NumberComposer } from './NumberComposer';
import { cn } from '@/lib/utils';

interface ItemDraft {
  title: string;
  description: string;
  period: string;
  price: string;
}

const EMPTY_ITEM: ItemDraft = { title: '', description: '', period: '', price: '' };

/**
 * Recovers the sequence and the letter code from a stored number.
 *
 * Used when opening a draft for editing, so the composer shows `037` and `SA`
 * rather than two empty boxes. If the stored number does not match the series'
 * template - it was typed by hand, or the template changed since - the parts come
 * back empty and the number is left in manual mode, because silently rebuilding a
 * number that does not match what is stored would change the document.
 */
function seedParts(
  seed: DocumentFormSeed | undefined,
  format: string | null,
): { seq: string; code: string } {
  if (!seed?.number) return { seq: '', code: '' };
  const seq = extractSegment(format, seed.number, 'seq');
  const code = extractSegment(format, seed.number, 'code');
  if (seq === null && code === null) return { seq: '', code: '' };
  return { seq: seq ?? '', code: code ?? '' };
}

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
  number: string | null;
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
    {
      id: string;
      label: string | null;
      company: string;
      docType: string;
      format: string | null;
      nextNumber: number | null;
    }[]
  >([]);
  const [seriesId, setSeriesId] = useState(seed?.seriesId ?? '');
  /**
   * The number the office actually supplies, split into the two parts that
   * change. A draft being edited is parsed back out of its stored number so the
   * composer opens showing the real sequence and code rather than blanks.
   */
  const [seq, setSeq] = useState('');
  const [code, setCode] = useState('');
  /** Set when the user types the whole number by hand instead. */
  const [manualNumber, setManualNumber] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [codeOptions, setCodeOptions] = useState<{ id: string; code: string }[]>([]);
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
        // Only when nothing is chosen yet. This ran unconditionally and
        // overwrote the series of a draft being edited with the first one in the
        // list, so opening a HYPE draft and saving it silently turned it into a
        // TNT document.
        if (rows.length > 0) setSeriesId((prev) => prev || rows[0].id);
      })
      .catch(() => toast.error('Gagal memuat seri dokumen.'));
  }, []);

  const current = series.find((s) => s.id === seriesId);
  /** A quotation is an offer: no company bank account. An invoice is payment. */
  const isInvoiceSeries = current?.docType === 'INVOICE';

  /**
   * The number that gets saved.
   *
   * Composed from the two parts the office supplies plus everything the date and
   * the series already know, unless the number was typed by hand. Keeping the
   * decision in one place means the preview, the saved document and the printed
   * page cannot each come out with a different number.
   */
  const composedValue = useMemo(
    () =>
      composeNumber({
        format: current?.format ?? null,
        seq,
        code,
        docType: current?.docType ?? 'QUOTATION',
        company: current?.company ?? 'TNT',
        date: issueDate || null,
      }).value,
    [current?.format, current?.docType, current?.company, seq, code, issueDate],
  );

  const number = manualNumber ? manualValue : composedValue;

  /**
   * Letter codes for the series, and the sequence pre-filled from its suggestion.
   *
   * The suggestion is advisory - the office types the number by hand because
   * nobody can say what every segment means - so it only pre-fills the box. A
   * draft being edited keeps its own sequence instead, or re-saving an unchanged
   * draft would quietly renumber it.
   */
  useEffect(() => {
    if (!seriesId) {
      setCodeOptions([]);
      return;
    }
    let cancelled = false;
    getNumberCodes(seriesId)
      .then((rows) => {
        if (!cancelled) setCodeOptions(rows.map((r) => ({ id: r.id, code: r.code })));
      })
      .catch(() => {
        if (!cancelled) setCodeOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [seriesId]);

  useEffect(() => {
    if (isEdit) return; // never renumber a draft that is being edited
    const suggestion = series.find((s) => s.id === seriesId)?.nextNumber;
    if (suggestion) setSeq(String(suggestion));
  }, [seriesId, isEdit, series]);

  /**
   * Split a stored number back into its parts, once, when the series and its
   * template have arrived. Done here rather than in the initial state because the
   * template lives on the server.
   *
   * If the stored number does not fit the template, the document goes into manual
   * mode with the number untouched. Rebuilding it from empty parts would print a
   * different number than the one already saved.
   */
  const [seededFromNumber, setSeededFromNumber] = useState(false);
  useEffect(() => {
    if (seededFromNumber) return;
    const format = current?.format ?? null;
    if (!format) return;
    if (!seed?.number) {
      setSeededFromNumber(true);
      return;
    }
    const parts = seedParts(seed, format);
    if (parts.seq === '' && parts.code === '') {
      setManualValue(seed.number);
      setManualNumber(true);
    } else {
      setSeq(parts.seq);
      setCode(parts.code);
    }
    setSeededFromNumber(true);
  }, [current?.format, seed, seededFromNumber]);

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
      /*
       * This was hardcoded null, which was right when a draft held no number and
       * the number was only assigned at publishing. Now the form composes the
       * number itself, so the preview was still showing a dash on a document
       * whose number was sitting right above it in the composer.
       */
      number,
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
      current, number, clientName, issueDate, period, items, totals,
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
        number: number.trim() || null,
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
          {/* The number comes first, before the client and before the items.
              Only the two parts that actually change are inputs: the running
              sequence and the letter code. The month and the year follow the
              document's date, the type and the company come from the series, so
              four of the six segments are no longer typed on every document -
              and a month typed by hand is a month that is wrong sooner or
              later. */}
          <div className="bg-white rounded-2xl border-2 border-indigo-200 p-5 space-y-4">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-indigo-400">
              1 &middot; Nomor dokumen
            </h2>
            <NumberComposer
              format={current?.format ?? null}
              docType={current?.docType ?? 'QUOTATION'}
              company={current?.company ?? 'TNT'}
              date={issueDate || null}
              seq={seq}
              code={code}
              onSeqChange={setSeq}
              onCodeChange={setCode}
              codes={codeOptions}
              manual={manualNumber}
              manualValue={manualValue}
              onManualValueChange={setManualValue}
              onSetManual={setManualNumber}
            />
            <p className="text-[10px] text-slate-400">
              Hasilnya:{' '}
              <span className="font-black text-slate-700 tabular-nums">
                {number || 'belum ada'}
              </span>
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              2 &middot; Dasar
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

                {/* Formatting Toolbar */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Rincian / Details
                    </span>
                    <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                      {/* Undo Button */}
                      <button
                        type="button"
                        onClick={() => {
                          const textarea = document.getElementById(`item-desc-${idx}`) as HTMLTextAreaElement | null;
                          if (textarea) {
                            textarea.focus();
                            document.execCommand('undo');
                          }
                        }}
                        className="p-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition"
                        title="Undo (Ctrl+Z)"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                      </button>

                      <div className="w-px h-3 bg-slate-300 mx-0.5" />

                      {/* Bold Button (Toggle) */}
                      <button
                        type="button"
                        onClick={() => {
                          const textarea = document.getElementById(`item-desc-${idx}`) as HTMLTextAreaElement | null;
                          if (!textarea) return;
                          const start = textarea.selectionStart;
                          const end = textarea.selectionEnd;
                          const val = item.description || '';
                          const selected = val.substring(start, end);
                          if (!selected) {
                            setItem(idx, { description: val + '**teks tebal**' });
                            return;
                          }
                          // If already bold (**text**), remove bold
                          if (selected.startsWith('**') && selected.endsWith('**')) {
                            const unbold = selected.slice(2, -2);
                            setItem(idx, { description: val.substring(0, start) + unbold + val.substring(end) });
                          } else {
                            setItem(idx, { description: val.substring(0, start) + `**${selected}**` + val.substring(end) });
                          }
                        }}
                        className="p-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition"
                        title="Tebal / Bold (Klik lagi untuk batal)"
                      >
                        <Bold className="w-3.5 h-3.5" />
                      </button>

                      {/* Italic Button (Toggle) */}
                      <button
                        type="button"
                        onClick={() => {
                          const textarea = document.getElementById(`item-desc-${idx}`) as HTMLTextAreaElement | null;
                          if (!textarea) return;
                          const start = textarea.selectionStart;
                          const end = textarea.selectionEnd;
                          const val = item.description || '';
                          const selected = val.substring(start, end);
                          if (!selected) {
                            setItem(idx, { description: val + '_teks miring_' });
                            return;
                          }
                          // If already italic (_text_), remove italic
                          if (selected.startsWith('_') && selected.endsWith('_')) {
                            const unitalic = selected.slice(1, -1);
                            setItem(idx, { description: val.substring(0, start) + unitalic + val.substring(end) });
                          } else {
                            setItem(idx, { description: val.substring(0, start) + `_${selected}_` + val.substring(end) });
                          }
                        }}
                        className="p-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition"
                        title="Miring / Italic (Klik lagi untuk batal)"
                      >
                        <Italic className="w-3.5 h-3.5" />
                      </button>

                      <div className="w-px h-3 bg-slate-300 mx-0.5" />

                      {/* Bullet List (Toggle) */}
                      <button
                        type="button"
                        onClick={() => {
                          const textarea = document.getElementById(`item-desc-${idx}`) as HTMLTextAreaElement | null;
                          if (!textarea) return;
                          const start = textarea.selectionStart;
                          const end = textarea.selectionEnd;
                          const val = item.description || '';
                          const selected = val.substring(start, end);
                          if (selected) {
                            const lines = selected.split('\n');
                            const allBulleted = lines.every((l) => /^[-*•]\s*/.test(l.trim()));
                            const toggled = lines
                              .map((l) => (allBulleted ? l.replace(/^[-*•]\s*/, '') : `• ${l.replace(/^[-*•]\s*/, '')}`))
                              .join('\n');
                            setItem(idx, { description: val.substring(0, start) + toggled + val.substring(end) });
                          } else {
                            const next = val ? `${val}\n• ` : '• ';
                            setItem(idx, { description: next });
                          }
                        }}
                        className="p-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition"
                        title="Bullet List (Klik lagi untuk batal)"
                      >
                        <List className="w-3.5 h-3.5" />
                      </button>

                      {/* Numbered List (Toggle) */}
                      <button
                        type="button"
                        onClick={() => {
                          const textarea = document.getElementById(`item-desc-${idx}`) as HTMLTextAreaElement | null;
                          if (!textarea) return;
                          const start = textarea.selectionStart;
                          const end = textarea.selectionEnd;
                          const val = item.description || '';
                          const selected = val.substring(start, end);
                          if (selected) {
                            const lines = selected.split('\n');
                            const allNumbered = lines.every((l) => /^\d+[\.\)]\s*/.test(l.trim()));
                            const toggled = lines
                              .map((l, i) =>
                                allNumbered ? l.replace(/^\d+[\.\)]\s*/, '') : `${i + 1}. ${l.replace(/^\d+[\.\)]\s*/, '')}`,
                              )
                              .join('\n');
                            setItem(idx, { description: val.substring(0, start) + toggled + val.substring(end) });
                          } else {
                            const next = val ? `${val}\n1. ` : '1. ';
                            setItem(idx, { description: next });
                          }
                        }}
                        className="p-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition"
                        title="Numbered List (Klik lagi untuk batal)"
                      >
                        <ListOrdered className="w-3.5 h-3.5" />
                      </button>

                      <div className="w-px h-3 bg-slate-300 mx-0.5" />

                      {/* Align Left (Toggle) */}
                      <button
                        type="button"
                        onClick={() => {
                          const textarea = document.getElementById(`item-desc-${idx}`) as HTMLTextAreaElement | null;
                          if (!textarea) return;
                          const start = textarea.selectionStart;
                          const end = textarea.selectionEnd;
                          const val = item.description || '';
                          const selected = val.substring(start, end) || 'Teks rata kiri';
                          const formatted = selected
                            .split('\n')
                            .map((line) => {
                              const isLeft = /\[left\]([\s\S]*?)\[\/left\]/i.test(line);
                              const cleaned = line.replace(/\[\/?(center|right|left)\]/gi, '').trim();
                              if (!cleaned) return '';
                              return isLeft ? cleaned : `[left]${cleaned}[/left]`;
                            })
                            .join('\n');
                          const next = val.substring(0, start) + formatted + val.substring(end);
                          setItem(idx, { description: next });
                        }}
                        className="p-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition"
                        title="Rata Kiri (Klik lagi untuk batal)"
                      >
                        <AlignLeft className="w-3.5 h-3.5" />
                      </button>

                      {/* Align Center (Toggle) */}
                      <button
                        type="button"
                        onClick={() => {
                          const textarea = document.getElementById(`item-desc-${idx}`) as HTMLTextAreaElement | null;
                          if (!textarea) return;
                          const start = textarea.selectionStart;
                          const end = textarea.selectionEnd;
                          const val = item.description || '';
                          const selected = val.substring(start, end) || 'Teks rata tengah';
                          const formatted = selected
                            .split('\n')
                            .map((line) => {
                              const isCenter = /\[center\]([\s\S]*?)\[\/center\]/i.test(line);
                              const cleaned = line.replace(/\[\/?(center|right|left)\]/gi, '').trim();
                              if (!cleaned) return '';
                              return isCenter ? cleaned : `[center]${cleaned}[/center]`;
                            })
                            .join('\n');
                          const next = val.substring(0, start) + formatted + val.substring(end);
                          setItem(idx, { description: next });
                        }}
                        className="p-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition"
                        title="Rata Tengah (Klik lagi untuk batal)"
                      >
                        <AlignCenter className="w-3.5 h-3.5" />
                      </button>

                      {/* Align Right (Toggle) */}
                      <button
                        type="button"
                        onClick={() => {
                          const textarea = document.getElementById(`item-desc-${idx}`) as HTMLTextAreaElement | null;
                          if (!textarea) return;
                          const start = textarea.selectionStart;
                          const end = textarea.selectionEnd;
                          const val = item.description || '';
                          const selected = val.substring(start, end) || 'Teks rata kanan';
                          const formatted = selected
                            .split('\n')
                            .map((line) => {
                              const isRight = /\[right\]([\s\S]*?)\[\/right\]/i.test(line);
                              const cleaned = line.replace(/\[\/?(center|right|left)\]/gi, '').trim();
                              if (!cleaned) return '';
                              return isRight ? cleaned : `[right]${cleaned}[/right]`;
                            })
                            .join('\n');
                          const next = val.substring(0, start) + formatted + val.substring(end);
                          setItem(idx, { description: next });
                        }}
                        className="p-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition"
                        title="Rata Kanan (Klik lagi untuk batal)"
                      >
                        <AlignRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <textarea
                    id={`item-desc-${idx}`}
                    value={item.description}
                    onChange={(e) => setItem(idx, { description: e.target.value })}
                    rows={5}
                    placeholder={'Rincian deliverables:\n1. 400 Creator Level 1\n2. 125 Creator Level 2\n• Upload 850 Video with Yellow Cart\n[center]Notes tambahan[/center]'}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[11px] text-slate-600 outline-none focus:ring-2 focus:ring-indigo-500 leading-relaxed resize-y font-mono"
                  />
                </div>

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
            {/*
             * Two of these cannot appear on a HYPE document at all, and leaving
             * them on screen is worse than hiding them: the office fills them in,
             * saves, and nothing prints.
             *
             * The HYPE layout, taken from their own quotation and invoice, has no
             * terms block and no "Approve by" line on the right. TNT uses both, so
             * they are gated on the company rather than on anything else.
             *
             * The tax RATE is not one of them. HYPE does print a rate - its table
             * header reads "Grand Total (Include Tax 0,5%)" - so only the label is
             * company-specific, and an earlier pass here hid the rate as well,
             * which would have silently dropped the tax off every HYPE invoice.
             */}
            {current?.company === 'HYPE' ? (
              <>
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
                    placeholder="0,5"
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-black text-slate-800 tabular-nums outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </label>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Tersimpan otomatis di baris &quot;Grand Total (Include Tax …)&quot;.
                  Dokumen HYPE tidak punya label pajak maupun ketentuan tertulis, jadi
                  field itu muncul kalau jenis dokumen diganti ke TNT.
                </p>
              </>
            ) : (
              <>
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
              Kosongkan kalau dokumen ini tidak menampilkan pajak. Quotation TNT juga
              tidak menampilkannya. Persentase diisi manual karena aturannya belum
              seragam antar perusahaan.
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
              </>
            )}
          </div>

          {/* bank + signature */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Rekening &amp; Penandatangan
            </h2>

            {/*
             * A quotation is an offer and carries no company bank account; an
             * invoice is the request for payment and does. Both the office's own
             * documents and the template follow that, so the fields are hidden on
             * a quotation rather than left there to be filled in and then not
             * printed.
             *
             * The values are kept in state rather than cleared, so switching the
             * series back to an invoice brings the account straight back.
             */}
            {isInvoiceSeries ? (
              <>
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
              </>
            ) : (
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Quotation adalah penawaran, jadi tidak ada rekening perusahaan di
                dalamnya. Kolom rekening muncul kalau jenis dokumen diganti ke
                Invoice.
              </p>
            )}

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

            {/* TNT prints an "Approve by" line on the right; HYPE does not have
                one anywhere in its layout, so the field is hidden there rather
                than left to be filled in and silently dropped. */}
            {current?.company !== 'HYPE' && (
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
            )}
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
