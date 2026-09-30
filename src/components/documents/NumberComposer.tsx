'use client';

import { useMemo } from 'react';
import { ComboBox } from './ComboBox';
import { composeNumber, parseTemplate } from '@/lib/document-number';
import { cn } from '@/lib/utils';

/**
 * Builds a document number from the parts that actually change.
 *
 * The office issues 037/QUO-TNT/SA/IX/26. Only two of those six parts change from
 * one document to the next: the running sequence and the letter code. The month
 * and the year come from the document's date, the type and the company from the
 * series. Asking for all six meant retyping four known facts on every document,
 * and a month typed by hand is a month that is wrong sooner or later.
 *
 * So the editable parts are real inputs and the rest are shown as fixed text,
 * assembled live from the series' own template. Nothing is hardcoded per company:
 * HYPE's number has no code, month or year, so HYPE simply shows fewer fields.
 *
 * A manual escape hatch is always available. A document whose number does not fit
 * the house template is a real thing that happens, and a form that cannot express
 * it is a form people work around.
 *
 * `manual` is owned by the form, not here, because the form is what saves the
 * number and the two must never disagree about which one is in effect.
 */
export function NumberComposer({
  format,
  docType,
  company,
  date,
  seq,
  code,
  onSeqChange,
  onCodeChange,
  codes,
  manual,
  manualValue,
  onManualValueChange,
  onSetManual,
}: {
  format: string | null;
  docType: string;
  company: string;
  /** Drives the month and the year segments. */
  date: string | null;
  seq: string;
  code: string;
  onSeqChange: (v: string) => void;
  onCodeChange: (v: string) => void;
  codes: { id: string; code: string }[];
  manual: boolean;
  manualValue: string;
  onManualValueChange: (v: string) => void;
  onSetManual: (v: boolean) => void;
}) {
  const tpl = useMemo(() => parseTemplate(format), [format]);

  const composed = useMemo(
    () =>
      composeNumber({
        format,
        seq,
        code,
        docType,
        company,
        date,
      }),
    [format, seq, code, docType, company, date],
  );

  // A series with no template has nothing to compose from, so it goes straight to
  // manual rather than showing a form that cannot produce a number.
  if (manual || tpl === null) {
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={manualValue}
            onChange={(e) => onManualValueChange(e.target.value)}
            placeholder="037/QUO-TNT/SA/IX/26"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm font-black text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums"
          />
          {tpl !== null && (
            <button
              type="button"
              onClick={() => onSetManual(false)}
              className="shrink-0 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-600 transition"
            >
              Susun otomatis
            </button>
          )}
        </div>
        <p className="text-[10px] text-slate-400">
          {tpl === null
            ? 'Seri ini tidak punya format nomor, jadi nomornya ditulis penuh.'
            : 'Nomor ditulis penuh tanpa assist. Klik "Susun otomatis" untuk kembali, dan bulan serta tahun akan ikut berubah mengikuti tanggal.'}
        </p>
      </div>
    );
  }

  const seqWidth = tpl.segments.find((s) => s.kind === 'seq')?.width ?? 3;
  const hasCode = tpl.segments.some((s) => s.kind === 'code');
  const hasDate = tpl.segments.some((s) => s.kind === 'roman' || s.kind === 'yy');
  // Only warn about a missing date on a series that actually prints one. HYPE's
  // number has no month or year, so telling its user to fill the date would be
  // advice about a field they cannot see.
  const missingDate =
    hasDate &&
    tpl.segments.some((s) => (s.kind === 'roman' || s.kind === 'yy') && !composed.parts[tpl.segments.indexOf(s)]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {tpl.segments.map((seg, i) => {
          const before = tpl.literals[i] ?? '';
          const lead = before ? (
            <span className="text-slate-400 font-black">{before}</span>
          ) : null;

          if (seg.kind === 'seq') {
            return (
              <span key={i} className="flex items-center gap-1.5 shrink-0">
                {lead}
                <input
                  type="text"
                  inputMode="numeric"
                  value={seq}
                  onChange={(e) => onSeqChange(e.target.value.replace(/\D/g, ''))}
                  placeholder={'0'.repeat(seqWidth)}
                  /*
                   * The width has to include the padding. Tailwind makes every
                   * element border-box, so a bare `3.5ch` leaves barely one
                   * character of room once px-2 and the border are taken out -
                   * the field then scrolls its own text and shows "7" for a
                   * sequence of 37, which is exactly the number nobody wanted.
                   */
                  style={{ width: `calc(${seqWidth}ch + 1.5rem)` }}
                  title="Nomor urut"
                  className="px-2 py-2 border-2 border-indigo-200 focus:border-indigo-500 rounded-lg text-sm font-black text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums text-center"
                />
              </span>
            );
          }

          if (seg.kind === 'code') {
            return (
              <span key={i} className="flex items-center gap-1.5 shrink-0">
                {lead}
                <div className="w-28">
                  <ComboBox
                    value={code}
                    onChange={onCodeChange}
                    options={codes.map((c) => ({ value: c.code, label: c.code }))}
                    placeholder="SA"
                  />
                </div>
              </span>
            );
          }

          // Month, year, type and company: shown, never asked for. The empty
          // amber state means the document has no date yet, which is a real
          // problem - a number printed with a blank month is a wrong number.
          const text = composed.parts[i] ?? '';
          return (
            <span key={i} className="flex items-center gap-1.5 shrink-0">
              {lead}
              <span
                title="Diisi otomatis, tidak perlu diketik"
                className={cn(
                  'px-2 py-1.5 rounded-lg text-sm font-black tabular-nums',
                  text
                    ? 'bg-slate-100 text-slate-500'
                    : 'bg-amber-50 text-amber-600 border border-amber-200',
                )}
              >
                {text || '?'}
              </span>
            </span>
          );
        })}
        <span className="shrink-0">{tpl.literals[tpl.literals.length - 1]}</span>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[10px] text-slate-400">
          {missingDate
            ? 'Isi tanggal dokumen dulu, bagian bulan dan tahun belum bisa dihitung.'
            : hasDate
              ? 'Bulan dan tahun ikut berubah sendiri mengikuti tanggal. Kotak abu-abu tidak perlu diisi.'
              : 'Kotak abu-abu tidak perlu diisi, semuanya sudah diketahui dari jenis dokumen.'}
          {hasCode ? ' Kode surat: pilih dari daftar atau ketik yang baru.' : ''}
        </p>
        <button
          type="button"
          onClick={() => onSetManual(true)}
          className="shrink-0 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-indigo-600 transition"
        >
          Tulis manual
        </button>
      </div>
    </div>
  );
}
