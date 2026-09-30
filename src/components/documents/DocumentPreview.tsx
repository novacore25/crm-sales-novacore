import type { ReactNode } from 'react';

/**
 * The two document templates.
 *
 * ONE component set renders both the on-screen preview and the printed page.
 * That is the point: a preview that is "close enough" to the print output is
 * worse than no preview, because someone signs off on a document that then
 * comes out of the printer different from what they approved. The same React
 * tree draws both, so a change to the layout cannot land in one place only.
 *
 * The two identities come from the paper the office already sends:
 *
 *   TNT  Thick and Thin Media Indonesia, maroon, five columns
 *   HYPE PT Synera Kreatif Grup, lime, four columns
 *
 * MCN is a product sold through the Thick and Thin letterhead, so it renders
 * on the TNT template. `company` picks the identity; `product` does not.
 */

export interface PreviewItem {
  title: string;
  description?: string | null;
  period?: string | null;
  price: number;
}

export interface PreviewDoc {
  company: string;
  docType: string;
  number: string | null;
  clientName: string;
  issueDate: string | null;
  period: string | null;
  items: PreviewItem[];
  subtotal: number;
  taxRate: number | null;
  taxLabel: string | null;
  taxAmount: number;
  grandTotal: number;
  terms: string | null;
  approverName: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankBranch: string | null;
  signatoryName: string | null;
  signatoryTitle: string | null;
}

const rupiah = (n: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);

/**
 * TNT prints its dates in English month names; HYPE prints them in Indonesian.
 * Matching that is not cosmetic - the office has been issuing documents this
 * way and changing it would make an old document and a new one look like they
 * came from different companies.
 */
const MONTHS_EN = [
  'JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
  'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER',
];
const MONTHS_ID = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember',
];

function formatDate(iso: string | null, lang: 'en' | 'id'): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const day = d.getDate();
  const month = (lang === 'en' ? MONTHS_EN : MONTHS_ID)[d.getMonth()];
  const year = d.getFullYear();
  return lang === 'en' ? `${day} ${month} ${year}` : `${day} ${month} ${year}`;
}

/**
 * Descriptions are free-form and multi-line, because every deal is described
 * differently. Newlines are preserved and rendered as separate lines rather
 * than collapsed - the samples use a bulleted list with nesting, and a run-on
 * paragraph is a real readability problem on a document a client reads.
 */
function Description({ text }: { text: string | null | undefined }) {
  if (!text?.trim()) return null;
  const lines = text.split(/\r?\n/);
  return (
    <div className="text-[10px] leading-relaxed text-slate-600 whitespace-pre-wrap break-words">
      {lines.map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-1" />;
        // A leading bullet marker is rendered as a real list item so wrapped
        // lines align under the text rather than under the dot.
        const m = /^[-*•]\s*(.*)$/.exec(t);
        if (m) {
          return (
            <div key={i} className="flex gap-1.5">
              <span className="shrink-0">&bull;</span>
              <span className="min-w-0">{m[1]}</span>
            </div>
          );
        }
        return <div key={i}>{t}</div>;
      })}
    </div>
  );
}

function Terms({ text }: { text: string | null | undefined }) {
  if (!text?.trim()) return null;
  return (
    <div className="text-[9px] leading-relaxed text-slate-600">
      {text.split(/\r?\n/).filter((l) => l.trim()).map((line, i) => {
        const t = line.trim();
        const m = /^[-*•]\s*(.*)$/.exec(t);
        return (
          <div key={i} className="flex gap-1.5">
            <span className="shrink-0">{m ? '\u2022' : '\u2013'}</span>
            <span className="min-w-0">{m ? m[1] : t}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thick and Thin
// ---------------------------------------------------------------------------

const MAROON = 'bg-[#5C2430]';
const MAROON_TEXT = 'text-[#5C2430]';
const MAROON_BORDER = 'border-[#5C2430]';

function TntTemplate({ doc }: { doc: PreviewDoc }) {
  const isInvoice = doc.docType === 'INVOICE';
  return (
    <div className="bg-white text-slate-800 min-h-full">
      {/* letterhead */}
      <div className="px-8 pt-7 pb-5 flex items-center gap-3">
        <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-amber-300 to-amber-500 flex items-center justify-center shrink-0">
          <span className="text-white text-xl font-black">T</span>
        </div>
        <div className="leading-none">
          <div className="text-[22px] font-black tracking-tight text-slate-900">
            Thick<span className="font-light">and Thin</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Media Indonesia</div>
        </div>
      </div>

      {/* title band */}
      <div className="flex items-stretch">
        <div className={`flex-1 ${MAROON}`} />
        <div className="px-8 py-3 text-[30px] font-black tracking-tight text-slate-900">
          {isInvoice ? 'INVOICE' : 'QUOTATION'}
        </div>
        <div className={`flex-1 ${MAROON}`} />
      </div>

      {/* to / date / number */}
      <div className="px-8 py-5 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">TO :</div>
          <div className="text-[15px] font-black text-slate-900 mt-0.5 break-words">
            {doc.clientName || '—'}
          </div>
        </div>
        <div className="shrink-0 text-right space-y-1">
          <div className="flex justify-end gap-2 text-[11px]">
            <span className={`font-black uppercase tracking-widest ${MAROON_TEXT}`}>DATE</span>
            <span className="text-slate-800 font-bold tabular-nums">
              {formatDate(doc.issueDate, 'en')}
            </span>
          </div>
          <div className="flex justify-end gap-2 text-[11px]">
            <span className={`font-black uppercase tracking-widest ${MAROON_TEXT}`}>NO.</span>
            <span className="text-slate-800 font-bold tabular-nums">
              {doc.number ?? <span className="italic text-slate-400">belum ada</span>}
            </span>
          </div>
        </div>
      </div>

      {/* items */}
      <div className="px-8">
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="px-2 py-2 text-left w-8">No</th>
              <th className="px-2 py-2 text-left">Description</th>
              <th className="px-2 py-2 text-right w-24">Price</th>
              <th className="px-2 py-2 text-center w-20">Period</th>
              <th className="px-2 py-2 text-right w-28">Total Price</th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((it, i) => (
              <tr key={i} className="border-b-2 border-slate-800/20 align-top">
                <td className="px-2 py-3 text-center font-black">{i + 1}</td>
                <td className="px-2 py-3">
                  <div className="font-black text-[11px] mb-1">{it.title}</div>
                  <Description text={it.description} />
                </td>
                <td className="px-2 py-3 text-right font-black tabular-nums">{rupiah(it.price)}</td>
                <td className="px-2 py-3 text-center font-bold text-[9px]">{it.period || '-'}</td>
                <td className="px-2 py-3 text-right font-black tabular-nums">{rupiah(it.price)}</td>
              </tr>
            ))}
            {doc.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-8 text-center text-slate-300 italic">
                  Belum ada item
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* totals + terms */}
      <div className="px-8 py-5 flex gap-6 items-start">
        <div className="flex-1 min-w-0 pt-1">
          <Terms text={doc.terms} />
        </div>
        <div className="w-64 shrink-0 text-[10px]">
          <div className="flex justify-between py-1 border-b border-slate-200">
            <span className="font-black uppercase tracking-widest text-slate-500">Total</span>
            <span className="font-black tabular-nums">{rupiah(doc.subtotal)}</span>
          </div>
          {doc.taxRate !== null && (
            <>
              <div className="flex justify-between py-1 border-b border-slate-200">
                <span className="font-black uppercase tracking-widest text-slate-500">
                  {doc.taxLabel || 'Tax'}
                </span>
                <span className="font-black tabular-nums">{rupiah(doc.taxAmount)}</span>
              </div>
              <div className="flex justify-between py-1.5 bg-slate-700 text-white px-2">
                <span className="font-black uppercase tracking-widest">Total Payment</span>
                <span className="font-black tabular-nums">{rupiah(doc.grandTotal)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* bank */}
      {(doc.bankName || doc.bankAccountName || doc.bankAccountNumber) && (
        <div className="px-8 pb-4 text-[9px] space-y-0.5">
          {doc.bankName && <div className="flex gap-2"><span className={`font-black ${MAROON_TEXT}`}>Bank</span><span className="text-slate-700">: {doc.bankName}</span></div>}
          {doc.bankAccountName && <div className="flex gap-2"><span className={`font-black ${MAROON_TEXT}`}>Account Name</span><span className="text-slate-700">: {doc.bankAccountName}</span></div>}
          {doc.bankAccountNumber && <div className="flex gap-2"><span className={`font-black ${MAROON_TEXT}`}>Account Number</span><span className="text-slate-700 tabular-nums">: {doc.bankAccountNumber}</span></div>}
          {doc.bankBranch && <div className="flex gap-2"><span className={`font-black ${MAROON_TEXT}`}>Branch</span><span className="text-slate-700">: {doc.bankBranch}</span></div>}
        </div>
      )}

      <Signatures doc={doc} maroon />

      <div className={`${MAROON} mt-6 px-8 py-3 flex items-center gap-2 text-white`}>
        <div className="h-0.5 flex-1 bg-amber-400" />
        <span className="text-[8px] font-bold">tntkreatif.com</span>
        <div className="h-0.5 w-16 bg-amber-400" />
        <span className="text-[8px] font-bold">Thick and Thin Media</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HYPE
// ---------------------------------------------------------------------------

const LIME = 'bg-[#D4FF00]';

function HypeTemplate({ doc }: { doc: PreviewDoc }) {
  const isInvoice = doc.docType === 'INVOICE';
  return (
    <div className="bg-white text-slate-900 min-h-full">
      <div className="flex">
        <div className="w-2/5 bg-slate-900 px-6 py-6 flex items-center">
          <span className="text-[28px] font-black tracking-tight text-[#D4FF00]">HYPE</span>
        </div>
        <div className={`${LIME} flex-1 px-6 py-4 text-[9px] leading-snug text-slate-900`}>
          <div className="text-right">
            Ruko Dynasty Walk Alam Sutera No 16, Jl. Jalur Sutera Raya<br />
            Kav 29C No 16, Pakualaman, Kec. Serpong Utara, Tangerang<br />
            Selatan, Banten 15320
          </div>
          <div className="text-right mt-1.5">hyprojectt@gmail.com &nbsp;+62 857-7411-2604</div>
        </div>
      </div>

      <div className="px-8 pt-6 pb-4">
        <h2 className="text-[22px] font-black tracking-tight">
          Official {isInvoice ? 'Invoice' : 'Quotation'}
        </h2>
      </div>

      <div className="px-8 pb-3 flex justify-end text-[11px] space-y-0.5">
        <div className="text-right">
          <div className="tabular-nums">{doc.number ?? <span className="italic text-slate-400">belum ada nomor</span>}</div>
          <div className="tabular-nums">{formatDate(doc.issueDate, 'id')}</div>
        </div>
      </div>

      <div className="px-8 pb-4">
        <div className="text-[15px] font-black">
          {isInvoice ? 'Invoice For' : 'Quotation For'}:{' '}
          <span className="font-light uppercase tracking-wide">{doc.clientName || '—'}</span>
        </div>
      </div>

      <div className="px-8">
        <table className="w-full border-collapse text-[10px] border-2 border-slate-900">
          <thead>
            <tr className={`${LIME} text-slate-900`}>
              <th className="px-3 py-2.5 text-left w-40">Package</th>
              <th className="px-3 py-2.5 text-center">Details</th>
              <th className="px-3 py-2.5 text-center w-24">Period</th>
              <th className="px-3 py-2.5 text-center w-44">
                {isInvoice && doc.taxRate !== null
                  ? `Grand Total (Include Tax ${doc.taxRate}%)`
                  : 'Total'}
              </th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((it, i) => (
              <tr key={i} className="border-b-2 border-slate-900 align-middle">
                <td className="px-3 py-4">
                  <div className="font-black text-[11px] leading-snug">{it.title}</div>
                </td>
                <td className="px-3 py-4">
                  <div className="flex justify-center">
                    <div className="w-full max-w-xs">
                      <Description text={it.description} />
                    </div>
                  </div>
                </td>
                <td className="px-3 py-4 text-center font-bold text-[9px]">{it.period || '-'}</td>
                <td className="px-3 py-4 text-center font-black tabular-nums">
                  {isInvoice && doc.taxRate !== null ? rupiah(doc.grandTotal) : rupiah(it.price)}
                </td>
              </tr>
            ))}
            {doc.items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-10 text-center text-slate-300 italic">
                  Belum ada item
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-8 py-4 text-[9px]">
        {isInvoice ? (
          <div className="space-y-0.5">
            <div className="font-black">Payment Method Information:</div>
            {doc.bankName && <div>{doc.bankName}</div>}
            {doc.bankAccountName && <div>{doc.bankAccountName}</div>}
            {doc.bankAccountNumber && <div className="tabular-nums">{doc.bankAccountNumber}</div>}
          </div>
        ) : (
          <div className="italic">*Prices quoted are exclusive of tax</div>
        )}
      </div>

      <div className="px-8 pb-6 pt-2 text-[10px]">
        <div className="font-black">PT SYNERA KREATIF GRUP</div>
      </div>

      <Signatures doc={doc} />

      <div className="h-16" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function Signatures({ doc, maroon }: { doc: PreviewDoc; maroon?: boolean }) {
  const nameColor = maroon ? MAROON_TEXT : 'text-slate-900';
  return (
    <div className="px-8 pt-6 pb-8 flex justify-between items-end gap-8">
      <div className="text-[10px]">
        {maroon && <div className={`font-black mb-6 ${nameColor}`}>Thank you,<br />Best Regards</div>}
        <div className="font-black underline underline-offset-2">{doc.signatoryName || '—'}</div>
        <div className="font-black uppercase text-slate-500 mt-0.5">
          {doc.signatoryTitle || '—'}
        </div>
      </div>
      <div className="text-[10px] text-right">
        <div className={`font-black mb-6 ${nameColor}`}>Approve by</div>
        <div className="font-black">{doc.approverName || doc.clientName || '—'}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function DocumentPreview({ doc }: { doc: PreviewDoc }): ReactNode {
  if (doc.company === 'HYPE') return <HypeTemplate doc={doc} />;
  return <TntTemplate doc={doc} />;
}
