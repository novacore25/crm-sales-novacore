import type { ReactNode } from 'react';

/**
 * The two document templates.
 *
 * ONE component set renders the on-screen preview and the printed page. A
 * preview that is "close enough" to the print output is worse than none,
 * because someone approves a document that then comes out of the printer
 * different from what they saw.
 *
 * Geometry: A4, 210 x 297 mm, always. The office's paper is not:
 *
 *   HYPE  595 x 842 pt  = 210 x 297 mm   already A4
 *   TNT   612 x 1048 pt = 216 x 370 mm   25% too tall
 *
 * Forcing TNT onto A4 without re-laying it out pushed the content onto a second
 * page, so the header and title band were compressed and the table given the
 * room it needs instead.
 *
 * The header and footer are `print:fixed`, which is how Chrome repeats them on
 * every page of a multi-page document. The spacing they occupy is applied
 * unconditionally, not only in print, so the preview shows the same geometry the
 * printer will.
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
 * TNT prints English month names, HYPE Indonesian. Matching that is not
 * cosmetic: the office has issued documents this way for years, and an old and
 * a new one have to look like they came from the same company.
 */
const MONTHS_EN = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];
const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function formatDate(iso: string | null, lang: 'en' | 'id'): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const day = d.getDate();
  const month = (lang === 'en' ? MONTHS_EN : MONTHS_ID)[d.getMonth()];
  return `${day} ${month} ${d.getFullYear()}`;
}

/**
 * Descriptions are free-form and multi-line, because every deal is described
 * differently. Newlines are preserved. A leading dash becomes a real list
 * item so a wrapped line aligns under the text rather than under the dot.
 */
function Description({ text }: { text: string | null | undefined }) {
  if (!text?.trim()) return null;
  return (
    <div className="text-[9.5px] leading-[1.5] text-slate-600 whitespace-pre-wrap break-words">
      {text.split(/\r?\n/).map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-1" />;
        const m = /^[-*•]\s*(.*)$/.exec(t);
        if (m) {
          return (
            <div key={i} className="flex gap-1.5 print:break-inside-avoid">
              <span className="shrink-0">&bull;</span>
              <span className="min-w-0">{m[1]}</span>
            </div>
          );
        }
        return <div key={i} className="print:break-inside-avoid">{t}</div>;
      })}
    </div>
  );
}

function Terms({ text }: { text: string | null | undefined }) {
  if (!text?.trim()) return null;
  return (
    <div className="text-[8.5px] leading-[1.5] text-slate-600">
      {text.split(/\r?\n/).filter((l) => l.trim()).map((line, i) => {
        const t = line.trim();
        const m = /^[-*•]\s*(.*)$/.exec(t);
        return (
          <div key={i} className="flex gap-1.5 print:break-inside-avoid">
            <span className="shrink-0">{m ? '\u2022' : '\u2013'}</span>
            <span className="min-w-0">{m ? m[1] : t}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

/**
 * The A4 sheet both templates render into.
 *
 * `print:fixed` on the header and footer is what makes them repeat on page two
 * and beyond. The top and bottom padding is applied in both modes on purpose:
 * if it only applied in print, the preview would look right and the printout
 * would shift the content up under the header.
 */
function Sheet({
  header,
  children,
  footer,
  footerSpace,
  headerSpace,
}: {
  header: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  headerSpace: string;
  footerSpace: string;
}) {
  return (
    <div className="bg-white text-slate-800 flex flex-col min-h-full print:min-h-0">
      {/* The page gutter is on all three bands, in both media. An earlier
          version dropped it from the body under `print:`, which put the whole
          document against the left trim edge and clipped it - and it only showed
          up on paper, because the screen preview is scaled and nobody compares
          it against a ruler. */}
      <div
        className="shrink-0 px-[14mm] bg-white sticky top-0 z-20 print:fixed print:top-0 print:left-0 print:right-0 print:w-[210mm] print:pt-[10mm]"
      >
        {header}
      </div>

      <div
        className="flex-1 px-[14mm]"
        style={{ paddingTop: headerSpace, paddingBottom: footerSpace }}
      >
        {children}
      </div>

      <div
        className="shrink-0 px-[14mm] bg-white sticky bottom-0 z-20 print:fixed print:bottom-0 print:left-0 print:right-0 print:w-[210mm]"
      >
        {footer}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thick and Thin
// ---------------------------------------------------------------------------

const MAROON = '#5C2430';
const MAROON_TEXT = 'text-[#5C2430]';

function TntTemplate({ doc }: { doc: PreviewDoc }) {
  const isInvoice = doc.docType === 'INVOICE';

  return (
    <Sheet
      headerSpace="32mm"
      footerSpace="18mm"
      header={
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-300 to-amber-500 flex items-center justify-center shrink-0">
            <span className="text-white text-lg font-black">T</span>
          </div>
          <div className="leading-none">
            {/* The wordmark needs a real space. JSX drops whitespace between an
                element and an inline sibling, which rendered it as
                "Thickand Thin". */}
            <div className="text-[17px] font-black tracking-tight text-slate-900">
              Thick<span className="font-light">&nbsp;and Thin</span>
            </div>
            <div className="text-[9px] text-slate-500 mt-0.5">Media Indonesia</div>
          </div>
        </div>
      }
      footer={
        /* Full-bleed: the bar runs off both trim edges and sits on the bottom of
           the sheet, as on the paper. The negative margin cancels the page
           gutter applied by the sheet. */
        <div style={{ background: MAROON }} className="-mx-[14mm] flex items-center gap-2 px-[14mm] py-2.5 text-white">
          <div className="h-0.5 flex-1 bg-amber-400" />
          <span className="text-[7.5px] font-bold">tntkreatif.com</span>
          <div className="h-0.5 w-14 bg-amber-400" />
          <span className="text-[7.5px] font-bold">Thick and Thin Media</span>
          <div className="h-0.5 flex-1 bg-amber-400" />
        </div>
      }
    >
      {/* Title band. Full-bleed, like the paper - it butts against both trim
          edges, which is most of what makes it read as a letterhead rather than
          a shaded heading. */}
      <div className="-mx-[14mm] flex items-stretch mb-5 print:break-after-avoid">
        <div className="flex-1" style={{ background: MAROON }} />
        <div className="px-7 py-2 text-[26px] font-black tracking-tight text-slate-900">
          {isInvoice ? 'INVOICE' : 'QUOTATION'}
        </div>
        <div className="flex-1" style={{ background: MAROON }} />
      </div>

      {/* to / date / number */}
      <div className="mb-4 flex items-start justify-between gap-6 print:break-after-avoid">
        <div className="min-w-0">
          <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">TO :</div>
          <div className="text-[14px] font-black text-slate-900 mt-0.5 break-words">
            {doc.clientName || '—'}
          </div>
        </div>
        <div className="shrink-0 text-right space-y-0.5">
          <div className="flex justify-end gap-2 text-[10px]">
            <span className={`font-black uppercase tracking-widest ${MAROON_TEXT}`}>DATE</span>
            <span className="text-slate-800 font-bold tabular-nums">
              {formatDate(doc.issueDate, 'en')}
            </span>
          </div>
          <div className="flex justify-end gap-2 text-[10px]">
            <span className={`font-black uppercase tracking-widest ${MAROON_TEXT}`}>NO.</span>
            <span className="text-slate-800 font-bold tabular-nums break-all">
              {doc.number ?? <span className="italic text-slate-400">—</span>}
            </span>
          </div>
        </div>
      </div>

      {/* items. The paper separates the columns with hairlines and leaves the
          description cell open, so the column edges carry the grid rather than a
          box around every cell. */}
      <table className="w-full border-collapse text-[9.5px]">
        <thead>
          <tr className="bg-slate-800 text-white print:break-after-avoid">
            <th className="px-2 py-1.5 text-left w-8">No</th>
            <th className="px-2 py-1.5 text-left border-l border-slate-400/40">Description</th>
            <th className="px-2 py-1.5 text-right w-24 border-l border-slate-400/40">Price</th>
            <th className="px-2 py-1.5 text-center w-20 border-l border-slate-400/40">Period</th>
            <th className="px-2 py-1.5 text-right w-28 border-l border-slate-400/40">Total Price</th>
          </tr>
        </thead>
        <tbody>
          {doc.items.map((it, i) => (
            <tr key={i} className="border-b border-slate-300 align-top print:break-inside-avoid">
              <td className="px-2 py-2.5 text-center font-black">{i + 1}</td>
              <td className="px-2 py-2.5 border-l border-slate-300">
                <div className="font-black text-[10.5px] mb-0.5">{it.title}</div>
                <Description text={it.description} />
              </td>
              <td className="px-2 py-2.5 text-right font-black tabular-nums whitespace-nowrap border-l border-slate-300">
                {rupiah(it.price)}
              </td>
              <td className="px-2 py-2.5 text-center font-bold text-[8.5px] border-l border-slate-300">
                {it.period || '-'}
              </td>
              <td className="px-2 py-2.5 text-right font-black tabular-nums whitespace-nowrap border-l border-slate-300">
                {rupiah(it.price)}
              </td>
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

      {/* terms on the left, money on the right. The totals sit on one grey
          block that starts at the page's midpoint, as on the paper - a stacked
          list of thin-bordered rows read as a spreadsheet, not a quotation. */}
      <div className="mt-4 flex gap-5 items-start print:break-inside-avoid">
        <div className="flex-1 min-w-0 pt-0.5">
          <Terms text={doc.terms} />
        </div>

        <div className="w-1/2 shrink-0 text-[9.5px]">
          <div className="px-2.5 py-1" style={{ background: '#808080' }}>
            <div className="flex justify-between gap-3 py-0.5">
              <span className="font-bold text-white">Total</span>
              <span className="font-bold text-white tabular-nums">{rupiah(doc.subtotal)}</span>
            </div>

            {doc.taxRate !== null &&
              (doc.taxAmount === 0 ? (
                /* A zero tax line is a deliberate correction - the office strikes
                   it out on paper rather than deleting the row, so the reader can
                   see the rate was considered. Printing a bare "Rp 0" instead
                   would just look like a mistake. */
                <div className="flex justify-between gap-3 py-0.5 text-red-600">
                  <span className="font-bold line-through">
                    {(doc.taxLabel || 'Tax').toUpperCase()} {doc.taxRate}%
                  </span>
                  <span className="font-bold tabular-nums line-through">
                    {rupiah(doc.taxAmount)}
                  </span>
                </div>
              ) : (
                <div className="flex justify-between gap-3 py-0.5">
                  <span className="font-bold text-white">
                    {(doc.taxLabel || 'Tax').toUpperCase()} {doc.taxRate}%
                  </span>
                  <span className="font-bold text-white tabular-nums">
                    {rupiah(doc.taxAmount)}
                  </span>
                </div>
              ))}

            <div className="flex justify-between gap-3 py-0.5">
              <span className="font-bold text-white">Total Payment</span>
              <span className="font-bold text-white tabular-nums">{rupiah(doc.grandTotal)}</span>
            </div>
          </div>

          {/* Bank details sit under the totals on the right, closed off with a
              gold rule - the same device the footer uses. */}
          {(doc.bankName || doc.bankAccountName || doc.bankAccountNumber) && (
            <div className="mt-2.5 pl-3 space-y-0.5" style={{ borderBottom: '1.5px solid #E8B923' }}>
              {doc.bankName && (
                <div className="flex gap-1.5">
                  <span className={`font-black ${MAROON_TEXT}`}>Bank</span>
                  <span className="text-slate-700">: {doc.bankName}</span>
                </div>
              )}
              {doc.bankAccountName && (
                <div className="flex gap-1.5">
                  <span className={`font-black ${MAROON_TEXT}`}>Account Name</span>
                  <span className="text-slate-700">: {doc.bankAccountName}</span>
                </div>
              )}
              {doc.bankAccountNumber && (
                <div className="flex gap-1.5">
                  <span className={`font-black ${MAROON_TEXT}`}>Account Number</span>
                  <span className="text-slate-700 tabular-nums">: {doc.bankAccountNumber}</span>
                </div>
              )}
              {doc.bankBranch && (
                <div className="flex gap-1.5">
                  <span className={`font-black ${MAROON_TEXT}`}>KCP</span>
                  <span className="text-slate-700">: {doc.bankBranch}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Signatures doc={doc} maroon />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// HYPE
// ---------------------------------------------------------------------------

const LIME = '#D4FF00';

function HypeTemplate({ doc }: { doc: PreviewDoc }) {
  const isInvoice = doc.docType === 'INVOICE';

  return (
    <Sheet
      headerSpace="30mm"
      footerSpace="16mm"
      header={
        <div className="flex items-stretch" style={{ margin: '0 -14mm' }}>
          <div className="w-[38%] bg-slate-900 px-4 py-2.5 flex items-center">
            <span className="text-[20px] font-black tracking-tight" style={{ color: LIME }}>HYPE</span>
          </div>
          <div className="flex-1 px-4 py-1.5 text-[7.5px] leading-snug text-slate-900" style={{ background: LIME }}>
            <div className="text-right">
              Ruko Dynasty Walk Alam Sutera No 16, Jl. Jalur Sutera Raya<br />
              Kav 29C No 16, Pakualaman, Kec. Serpong Utara, Tangerang Selatan, Banten 15320
            </div>
            <div className="text-right mt-0.5">hyprojectt@gmail.com &nbsp;+62 857-7411-2604</div>
          </div>
        </div>
      }
      footer={
        <div
          className="-mx-[14mm] flex items-center gap-3 border-t-[3px] px-[14mm] py-2"
          style={{ borderColor: LIME }}
        >
          <span className="text-[8px] font-black uppercase tracking-widest">PT Synera Kreatif Grup</span>
          <div className="h-0.5 flex-1 bg-slate-900" />
          <span className="text-[7.5px] text-slate-500">hyprojectt@gmail.com &middot; +62 857-7411-2604</span>
        </div>
      }
    >
      <h2 className="text-[20px] font-black tracking-tight mb-2 print:break-after-avoid">
        Official {isInvoice ? 'Invoice' : 'Quotation'}
      </h2>

      <div className="flex justify-end text-[10px] mb-3 print:break-after-avoid">
        <div className="text-right">
          <div className="tabular-nums break-all">
            {doc.number ?? <span className="italic text-slate-400">—</span>}
          </div>
          <div className="tabular-nums">{formatDate(doc.issueDate, 'id')}</div>
        </div>
      </div>

      <div className="mb-3 print:break-after-avoid">
        <div className="text-[14px] font-black">
          {isInvoice ? 'Invoice For' : 'Quotation For'}:{' '}
          <span className="font-light uppercase tracking-wide">{doc.clientName || '—'}</span>
        </div>
      </div>

      <table className="w-full border-collapse text-[9.5px] border-2 border-slate-900">
        <thead>
          <tr style={{ background: LIME }} className="text-slate-900 print:break-after-avoid">
            <th className="px-3 py-2 text-left w-36">Package</th>
            <th className="px-3 py-2 text-center">Details</th>
            <th className="px-3 py-2 text-center w-24">Period</th>
            <th className="px-3 py-2 text-center w-44">
              {isInvoice && doc.taxRate !== null
                ? `Grand Total (Include Tax ${doc.taxRate}%)`
                : 'Total'}
            </th>
          </tr>
        </thead>
        <tbody>
          {doc.items.map((it, i) => (
            <tr key={i} className="border-b-2 border-slate-900 align-middle print:break-inside-avoid">
              <td className="px-3 py-3">
                <div className="font-black text-[10.5px] leading-snug">{it.title}</div>
              </td>
              <td className="px-3 py-3">
                <div className="flex justify-center">
                  <div className="w-full max-w-[240px]">
                    <Description text={it.description} />
                  </div>
                </div>
              </td>
              <td className="px-3 py-3 text-center font-bold text-[8.5px]">{it.period || '-'}</td>
              <td className="px-3 py-3 text-center font-black tabular-nums whitespace-nowrap">
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

      <div className="mt-2.5 text-[8.5px] print:break-inside-avoid">
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

      <Signatures doc={doc} companyLine="PT SYNERA KREATIF GRUP" />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function Signatures({
  doc,
  maroon,
  companyLine,
}: {
  doc: PreviewDoc;
  maroon?: boolean;
  companyLine?: string;
}) {
  const nameColor = maroon ? MAROON_TEXT : 'text-slate-900';
  return (
    <div className="mt-5 print:break-inside-avoid">
      {companyLine && <div className="text-[9.5px] font-black mb-8">{companyLine}</div>}
      <div className="flex justify-between items-end gap-8">
        <div className="text-[9.5px]">
          {maroon && <div className={`font-black mb-8 ${nameColor}`}>Thank you,<br />Best Regards</div>}
          <div className="font-black underline underline-offset-2">{doc.signatoryName || '—'}</div>
          <div className="font-black uppercase text-slate-500 mt-0.5">{doc.signatoryTitle || '—'}</div>
        </div>
        <div className="text-[9.5px] text-right">
          <div className={`font-black mb-8 ${nameColor}`}>Approve by</div>
          <div className="font-black">{doc.approverName || doc.clientName || '—'}</div>
        </div>
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
