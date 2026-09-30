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
 * The header and footer repeat on every printed page through `print:fixed`,
 * which is how Chrome runs them. On screen the header is `sticky` so the company
 * identity stays visible while scrolling a long document, and the footer is left
 * to the flex layout so it lands on the page's bottom edge - `sticky bottom-0`
 * resolves against the preview pane rather than the page, and pulled the footer
 * 105mm up the sheet.
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

/**
 * `id-caps` exists because HYPE quotations print their date in capitals
 * ("11 SEPTEMBER 2026") while HYPE invoices do not ("15 Juni 2026"). That
 * inconsistency is in the office's own documents. Normalising it would be tidier
 * and wrong: an old and a new document would stop looking like they came from
 * the same company.
 */
function formatDate(iso: string | null, lang: 'en' | 'id' | 'id-caps'): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const day = d.getDate();
  const month = (lang === 'en' ? MONTHS_EN : MONTHS_ID)[d.getMonth()];
  return `${day} ${lang === 'id-caps' ? month.toUpperCase() : month} ${d.getFullYear()}`;
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
  headerHeight,
}: {
  header: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  /** Gap between the header and the content. */
  headerSpace: string;
  footerSpace: string;
  /** The header's own height, needed to keep print and screen in step. */
  headerHeight: string;
}) {
  /*
   * The page top margin is applied in both media, not just print.
   *
   * Most printers cannot print to the trim edge, so the printed sheet needs a
   * margin. Applying it only under `print:` meant the preview and the printout
   * disagreed about where the document began, which is the one thing a preview
   * has to be right about. Six millimetres is inside what an office printer can
   * reach.
   */
  const topMargin = '6mm';
  /*
   * In print the header is position:fixed so it repeats on every page, and fixed
   * takes it out of the flow - the body then starts at the very top of the sheet
   * and the content slides up underneath the header. On screen the header is
   * sticky, which stays in the flow and pushes the body down. The two therefore
   * disagree by the header's height, and only the print side needs a spacer.
   */
  const printSpacer = `calc(${topMargin} + ${headerHeight})`;

  return (
    <div className="bg-white text-slate-800 flex flex-col min-h-[297mm] print:min-h-0">
      {/* The page gutter is on all three bands, in both media. An earlier
          version dropped it from the body under `print:`, which put the whole
          document against the left trim edge and clipped it - and it only showed
          up on paper, because the screen preview is scaled and nobody compares
          it against a ruler. */}
      <div
        className="shrink-0 px-[14mm] bg-white sticky top-0 z-20 print:fixed print:top-0 print:left-0 print:right-0 print:w-[210mm]"
        style={{ paddingTop: topMargin }}
      >
        {header}
      </div>

      <div
        className="flex-1 px-[14mm]"
        style={{ paddingTop: headerSpace, paddingBottom: footerSpace }}
      >
        <div className="hidden print:block" style={{ height: printSpacer }} />
        {children}
      </div>

      {/* The footer is placed by the flex layout, not by `sticky bottom-0`.
          Sticky resolves against the nearest scrolling ancestor, which is the
          preview pane and not the page - so on a short document it hauled the
          footer up to the bottom of the visible area and left 105mm of blank
          paper underneath it. Flex puts it on the page's bottom edge, which is
          where the printed document has it. The printed page still repeats it on
          every sheet via print:fixed. */}
      <div
        className="shrink-0 px-[14mm] bg-white print:fixed print:bottom-0 print:left-0 print:right-0 print:z-20 print:w-[210mm]"
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
      headerHeight="11mm"
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
const LIME = '#C3E800';

/**
 * HYPE. Rebuilt from measurements taken off the office's own PDFs rather than
 * from how it looked in a thumbnail, which is how the previous version ended up
 * wrong in five ways at once.
 *
 * What the PDFs actually say, and what this now does:
 *
 * - The lime is #C3E800. It had been #D4FF00, guessed.
 * - The letterhead is a black ribbon with a notched right edge overlapping a
 *   lime band that runs to the right edge, with the address BELOW the band on
 *   white. The address had been put inside the lime block, which is not where it
 *   is on the paper.
 * - The table columns are not the same on the two document types. A quotation
 *   gives the Total column 42% and Details 30%; an invoice gives Details 48% and
 *   Total 21%, because its header is "Grand Total (Include Tax 0,5%)" on two
 *   lines. One set of widths cannot be right for both.
 * - The body cells are centred and generously padded. They were left-aligned and
 *   tight.
 * - There is no footer and no "Approve by" block. Both were invented. The paper
 *   has the company name and the signatory at the bottom left, unsigned and
 *   un-underlined, and nothing else.
 *
 * The quotation prints its date in capitals ("11 SEPTEMBER 2026") and the
 * invoice does not ("15 Juni 2026"). That inconsistency is in the office's own
 * documents, so it is reproduced rather than quietly tidied up.
 */
function HypeTemplate({ doc }: { doc: PreviewDoc }) {
  const isInvoice = doc.docType === 'INVOICE';

  // Measured off the two PDFs, as a share of the table's width.
  const columns = isInvoice
    ? { pkg: '17%', details: '48%', period: '15%', total: '21%' }
    : { pkg: '17%', details: '30%', period: '12%', total: '42%' };

  return (
    <Sheet
      headerSpace="8mm"
      /* Reserves room so long content never runs under the fixed footer. */
      footerSpace="67mm"
      headerHeight="42mm"
      header={
        <div className="relative" style={{ margin: '0 -14mm', height: '42mm' }}>
          {/* The lime band runs from a quarter of the way across to the right
              trim edge, and only 13.7mm deep. */}
          <div
            className="absolute top-0"
            style={{ left: '26.4%', right: 0, height: '13.7mm', background: LIME }}
          />
          {/* The black ribbon: full height on the left, with a notch cut out of
              its right edge below the band. clip-path because the notch is the
              whole identity of the letterhead and a border cannot make it. */}
          <div
            className="absolute top-0 left-0 z-10"
            style={{
              width: '39.1%',
              height: '42mm',
              background: '#000',
              clipPath: 'polygon(0 0, 64% 0, 100% 30%, 64% 100%, 0 100%)',
            }}
          />
          <span
            className="absolute z-20 font-black tracking-tight"
            style={{ left: '4.9%', top: '15mm', fontSize: '26px', color: LIME }}
          >
            HYPE
          </span>

          {/* The address sits on white, right-aligned, below the band and to the
              right of the ribbon. */}
          <div
            className="absolute text-right leading-[1.32] text-slate-900"
            style={{ right: '5%', top: '17.2mm', fontSize: '11pt' }}
          >
            Ruko Dynasty Walk Alam Sutera No 16, Jl. Jalur Sutera Raya
            <br />
            Kav 29C No 16, Pakualam, Kec. Serpong Utara, Tangerang
            <br />
            Selatan, Banten 15320
            <div className="mt-[13pt]">
              hyprojectt@gmail.com
              <br />+62 857-7411-2604
            </div>
          </div>
        </div>
      }
      footer={
        /* Not a footer bar. On the paper this is simply the last thing on the
           page: the company name, a gap, then the signatory - unsigned, no
           "Approve by" on the right.

           The padding is inside the block, not on the sheet. The footer is
           print:fixed bottom:0, so the sheet's footerSpace reserves room for it
           but does not move it; without this the last line sat on the trim edge
           instead of the 10%-up position the original has. */
        <div className="text-[11pt] text-slate-900 print:break-inside-avoid" style={{ paddingBottom: '28mm' }}>
          <div className="font-normal">PT SYNERA KREATIF GRUP</div>
          <div className="mt-[24mm]">
            <div>{doc.signatoryName || '—'}</div>
            <div>{doc.signatoryTitle || '—'}</div>
          </div>
        </div>
      }
    >
      <h2
        className="font-black tracking-tight print:break-after-avoid"
        style={{ fontSize: '24pt', marginBottom: '13mm' }}
      >
        Official {isInvoice ? 'Invoice' : 'Quotation'}
      </h2>

      <div className="flex justify-end print:break-after-avoid" style={{ fontSize: '11pt' }}>
        <div className="text-right tabular-nums">
          <div className="break-all">
            {doc.number ?? <span className="italic text-slate-400">—</span>}
          </div>
          {/* A quotation prints its date in capitals and an invoice does not.
              Both are in the office's own documents, so both are reproduced. */}
          <div>{formatDate(doc.issueDate, isInvoice ? 'id' : 'id-caps')}</div>
        </div>
      </div>

      <div className="print:break-after-avoid" style={{ fontSize: '16pt', margin: '9mm 0 7mm' }}>
        <span className="font-black">{isInvoice ? 'Invoice For' : 'Quotation For'} :</span>{' '}
        <span className="font-normal">{doc.clientName || '—'}</span>
      </div>

      <table
        className="w-full border-collapse"
        style={{ border: '2px solid #000', fontSize: '7.5pt' }}
      >
        <thead>
          <tr style={{ background: LIME }} className="print:break-after-avoid">
            <th
              className="px-2 py-2 text-center font-bold"
              style={{ width: columns.pkg, color: '#000', fontSize: '9pt' }}
            >
              Package
            </th>
            <th
              className="px-2 py-2 text-center font-bold"
              style={{ width: columns.details, color: '#000', fontSize: '9pt', borderLeft: '1px solid #000' }}
            >
              Details
            </th>
            <th
              className="px-2 py-2 text-center font-bold"
              style={{ width: columns.period, color: '#000', fontSize: '9pt', borderLeft: '1px solid #000' }}
            >
              Period
            </th>
            <th
              className="px-2 py-2 text-center font-bold"
              style={{ width: columns.total, color: '#000', fontSize: '9pt', borderLeft: '1px solid #000' }}
            >
              {isInvoice ? (
                <>
                  Grand Total
                  <br />
                  (Include Tax {String(doc.taxRate ?? 0).replace('.', ',')}%)
                </>
              ) : (
                'Total'
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {doc.items.map((it, i) => (
            <tr key={i} className="print:break-inside-avoid" style={{ borderTop: '1px solid #000' }}>
              <td
                className="px-3 text-center align-middle font-bold"
                style={{ fontSize: '10pt', padding: '9mm 3mm' }}
              >
                {it.title}
              </td>
              <td
                className="px-3 text-center align-middle"
                style={{ borderLeft: '1px solid #000', padding: '9mm 3mm' }}
              >
                <div style={{ maxWidth: '46mm', margin: '0 auto' }}>
                  <CentredDescription text={it.description} />
                </div>
              </td>
              <td
                className="px-3 text-center align-middle"
                style={{ borderLeft: '1px solid #000', padding: '9mm 3mm' }}
              >
                {it.period || '-'}
              </td>
              <td
                className="px-3 text-center align-middle font-bold"
                style={{ borderLeft: '1px solid #000', padding: '9mm 3mm', fontSize: '10pt' }}
              >
                {isInvoice && doc.taxRate !== null
                  ? rupiah(Math.round((doc.subtotal * (100 + doc.taxRate)) / 100))
                  : rupiah(it.price)}
              </td>
            </tr>
          ))}
          {doc.items.length === 0 && (
            <tr>
              <td colSpan={4} className="text-center italic text-slate-300" style={{ padding: '9mm' }}>
                Belum ada item
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt-2" style={{ fontSize: '11pt' }}>
        {isInvoice ? (
          <div className="leading-[1.4]">
            <div className="font-bold">Payment Method Information:</div>
            {doc.bankName && <div>{doc.bankName}</div>}
            {doc.bankAccountName && <div>{doc.bankAccountName}</div>}
            {doc.bankAccountNumber && <div className="tabular-nums">{doc.bankAccountNumber}</div>}
          </div>
        ) : (
          <div style={{ fontSize: '10pt' }}>*Prices quoted are exclusive of tax</div>
        )}
      </div>
    </Sheet>
  );
}

/**
 * HYPE prints its descriptions centred, with a clear gap between paragraphs and
 * a tight one between wrapped lines of the same paragraph. The left-aligned,
 * uniform version read as a different document.
 */
function CentredDescription({ text }: { text: string | null | undefined }) {
  if (!text?.trim()) return null;
  return (
    <div className="text-center text-slate-800">
      {text.split(/\r?\n/).map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} style={{ height: '6pt' }} />;
        return (
          <div key={i} className="print:break-inside-avoid" style={{ lineHeight: '9pt' }}>
            {t}
          </div>
        );
      })}
    </div>
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
