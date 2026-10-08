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
 * Render inline markdown styles: **bold**, *bold*, _italic_.
 */
function renderInlineFormatted(text: string) {
  // Split by markdown bold (**text** or *text*) and italic (_text_)
  const parts: (string | React.ReactNode)[] = [];
  // Tokenize regex
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={match.index} className="font-bold text-slate-800">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<strong key={match.index} className="font-bold text-slate-800">{token.slice(1, -1)}</strong>);
    } else if (token.startsWith('_') && token.endsWith('_')) {
      parts.push(<em key={match.index} className="italic">{token.slice(1, -1)}</em>);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

/**
 * Rich description renderer supporting lists, inline bold/italic, and [center]/[right]/[left] alignments.
 */
function RichDescription({
  text,
  defaultAlign = 'left',
  textColor = 'text-slate-600',
}: {
  text: string | null | undefined;
  defaultAlign?: 'left' | 'center' | 'right';
  textColor?: string;
}) {
  if (!text?.trim()) return null;

  // Normalize text: handle multi-line [center]...[/center], [right]...[/right], [left]...[/left]
  // by pushing alignment down to each enclosed line.
  let processed = text
    .replace(/\[center\]([\s\S]*?)\[\/center\]/gi, (_, inner) =>
      inner
        .split(/\r?\n/)
        .map((l: string) => (l.trim() ? `[center]${l.trim()}[/center]` : ''))
        .join('\n'),
    )
    .replace(/\[right\]([\s\S]*?)\[\/right\]/gi, (_, inner) =>
      inner
        .split(/\r?\n/)
        .map((l: string) => (l.trim() ? `[right]${l.trim()}[/right]` : ''))
        .join('\n'),
    )
    .replace(/\[left\]([\s\S]*?)\[\/left\]/gi, (_, inner) =>
      inner
        .split(/\r?\n/)
        .map((l: string) => (l.trim() ? `[left]${l.trim()}[/left]` : ''))
        .join('\n'),
    );

  return (
    <div className={`text-[10px] leading-[1.5] ${textColor} whitespace-pre-wrap break-words space-y-0.5`}>
      {processed.split(/\r?\n/).map((line, i) => {
        let t = line.trim();
        if (!t) return <div key={i} className="h-1" />;

        // Check alignment tags [center], [right], [left]
        let align = defaultAlign;
        const centerMatch = /^\[center\]([\s\S]*?)(\[\/center\])?$/i.exec(t);
        const rightMatch = /^\[right\]([\s\S]*?)(\[\/right\])?$/i.exec(t);
        const leftMatch = /^\[left\]([\s\S]*?)(\[\/left\])?$/i.exec(t);

        if (centerMatch) {
          align = 'center';
          t = centerMatch[1].replace(/\[\/?center\]/gi, '').trim();
        } else if (rightMatch) {
          align = 'right';
          t = rightMatch[1].replace(/\[\/?right\]/gi, '').trim();
        } else if (leftMatch) {
          align = 'left';
          t = leftMatch[1].replace(/\[\/?left\]/gi, '').trim();
        }

        // Clean any stray tags just in case
        t = t.replace(/\[\/?(center|right|left)\]/gi, '').trim();

        // Check Numbered List e.g. "1. ", "2) ", "10. "
        const numMatch = /^(\d+[\.\)])\s*(.*)$/.exec(t);
        if (numMatch) {
          return (
            <div
              key={i}
              className={`flex gap-1.5 print:break-inside-avoid ${
                align === 'center' ? 'justify-center text-center' : align === 'right' ? 'justify-end text-right' : 'text-left'
              }`}
            >
              <span className="shrink-0 font-bold tabular-nums">{numMatch[1]}</span>
              <span className="min-w-0">{renderInlineFormatted(numMatch[2])}</span>
            </div>
          );
        }

        // Check Bullet List e.g. "- ", "* ", "• "
        const bulletMatch = /^[-*•]\s*(.*)$/.exec(t);
        if (bulletMatch) {
          return (
            <div
              key={i}
              className={`flex gap-1.5 print:break-inside-avoid ${
                align === 'center' ? 'justify-center text-center' : align === 'right' ? 'justify-end text-right' : 'text-left'
              }`}
            >
              <span className="shrink-0 font-bold">&bull;</span>
              <span className="min-w-0">{renderInlineFormatted(bulletMatch[1])}</span>
            </div>
          );
        }

        // Plain line
        return (
          <div
            key={i}
            className={`print:break-inside-avoid ${
              align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'
            }`}
          >
            {renderInlineFormatted(t)}
          </div>
        );
      })}
    </div>
  );
}

function Description({ text }: { text: string | null | undefined }) {
  return <RichDescription text={text} defaultAlign="left" />;
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
 * The office's own letterhead artwork.
 *
 * The files in public/documents are the real thing, exported from their own
 * design: a full A4 page whose body area is empty and whose header band and
 * footer bar are drawn in. They are placed as a background scaled to the whole
 * page and cropped by the height of the element, so the header shows the top of
 * the page and the footer the bottom of it. Measuring where the ink actually
 * sits gave these numbers:
 *
 *   TNT logo            9.2 - 25.5mm
 *   TNT title band     33.2 - 45.9mm   so the header is 46mm tall
 *   TNT footer bar    268.3 - 296.6mm   so the footer is 28.3mm and runs to the trim edge
 *   HYPE letterhead     0.0 - 44.1mm
 *
 * Nothing about the shapes is described in CSS any more, which is the point. The
 * previous hand-built versions were measured off a 4x render of these same files
 * and still got the ribbon's notch, the lime and the band's position wrong.
 *
 * One consequence worth knowing: the artwork is a background image, so Chrome's
 * print dialog must have "Background graphics" enabled or the letterhead does
 * not print at all. That was already true of the coloured bands before, but now
 * it is the whole header rather than a decorative stripe, and the print page
 * says so on the toolbar.
 *
 * KNOWN ISSUE in the TNT artwork, not fixable from here: Chromium's PDF output
 * draws a hairline rectangle around the TNT logo. It is not visible on screen and
 * it is not caused by the way the file is placed here - printing the raw SVG on
 * its own, untouched, produces the same line. The logo is masked by applying a
 * greyscale image as a luminance mask, and the mask's edge lands within a pixel
 * of the logo's own bounding box, so the anti-aliased edge survives as a visible
 * outline once the page is rasterised for print.
 *
 * Three attempts were made and all failed to remove it without changing how the
 * logo looks: explicit mask bounds, mask-type="luminance", and switching from a
 * CSS background to an <img>. Removing the mask entirely does clear the line, but
 * it leaves the logo on a black rectangle, because the mask is what knocks out
 * the image's background. It needs fixing at the source: re-export the logo from
 * the design tool as a placed image with the transparency already applied, rather
 * than masked.
 *
 * The HYPE letterhead uses a pattern fill rather than a mask and prints clean.
 */
function Letterhead({
  src,
  height,
  edge,
  logo,
}: {
  src: string;
  height: string;
  edge: 'top' | 'bottom';
  /** Overlay drawn on top, for artwork that was taken out of the SVG. */
  logo?: ReactNode;
}) {
  return (
    <div
      className="relative"
      style={{
        /*
         * Full bleed, and it has to be done here rather than by the caller.
         *
         * The sheet gives the header 14mm of side padding for the body text. A
         * 210mm-wide background centred inside the 182mm that padding leaves is
         * clipped 14mm off on each side, and CSS clips a background to its
         * element - so the artwork came out inset from both trim edges: the HYPE
         * letterhead stopped short of the paper, and TNT's title band and footer
         * bar did too. Every one of those is drawn to run off the edge.
         */
        margin: '0 -14mm',
        height,
        backgroundImage: `url(${src})`,
        backgroundSize: '210mm 297mm',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: edge === 'top' ? 'top center' : 'bottom center',
      }}
    >
      {logo}
    </div>
  );
}

/**
 * The TNT mark, overlaid on the letterhead.
 *
 * The SVG carried it as a luminance-masked raster, and that mask leaves a
 * hairline rectangle around the logo in Chromium's PDF output - invisible on
 * screen, present on paper, and reproducing when the raw SVG is printed
 * untouched. scripts/strip-tnt-logo.py takes the masked group out of both files.
 *
 * It also turned out to be the wrong artwork: that raster is a square lockup
 * reading "THICK & THIN MEDIA" over "Official TikTok Agency", and neither line
 * appears on the office's quotation PDFs. The wordmark beside the mark in those
 * PDFs is separate vector art in the SVG and is untouched by the strip, so only
 * the mark needs replacing.
 *
 * The office's own logo-tnt-lanscape.png was the first choice and could not be
 * used: its mark is 67px, and at the 16.6mm the mark actually occupies on the
 * page that is 99 dpi. Vector-accurate enough for a screen, visibly soft in
 * print. This mark is lifted out of the SVG's own 615px artwork instead and
 * baked to a plain RGBA PNG with no mask, so it prints at 472 dpi.
 *
 * Placed from the SVG's geometry rather than by eye. The masked group sat at
 * translate(36.586, 0.867) with scale 0.145047, and the mark's ink filled
 * x 145..468 and y 93..417 of that image, which puts it at 20.2mm across and
 * 5.0mm down, 16.4mm square. The vector wordmark starts at 42mm, so the gap that
 * produces is the one the design already had.
 */
function TntMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/documents/logo-tnt-mark.png"
      alt=""
      style={{ position: 'absolute', left: '20.2mm', top: '5.0mm', width: '16.4mm' }}
    />
  );
}

/**
 * The A4 sheet both templates render into.
 *
 * The header and footer repeat on every printed page through `print:fixed`,
 * which is how Chrome runs them. On screen the header is `sticky` so the company
 * identity stays visible while scrolling a long document, and the footer is left
 * to the flex layout so it lands on the page's bottom edge - `sticky bottom-0`
 * resolves against the preview pane rather than the page, and pulled the footer
 * 105mm up the sheet.
 *
 * The top and bottom spacing is applied in both modes on purpose: if it only
 * applied in print, the preview would look right and the printout would shift
 * the content up under the header.
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
   * No top margin.
   *
   * There was a 6mm one, for the usual reason that printers cannot print to the
   * trim edge. But the letterhead is artwork designed to bleed: the HYPE ribbon
   * starts at y=0 and the TNT logo sits at 9.2mm. A margin does not move the
   * artwork safely, it leaves a white strip above a black shape that was drawn
   * to run off the edge, which looks like a mistake rather than a margin. The
   * office's own PDFs also start at y=0.
   *
   * A printer that clips the first few millimetres will shave the top of the
   * HYPE ribbon. That is a property of the printer, not of the file.
   */
  const topMargin = '0mm';
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

const MAROON_TEXT = 'text-[#5C2430]';

function TntTemplate({ doc }: { doc: PreviewDoc }) {
  // Two letterheads because the title band is part of the artwork: one says
  // QUOTATION, the other INVOICE. Picking the wrong one would print a document
  // headed INVOICE that the archive lists as a quotation.
  const tntArt = doc.docType === 'INVOICE' ? '/documents/tnt-invoice.svg' : '/documents/tnt-quotation.svg';
  /*
   * A quotation is an offer, so it carries no company bank account. An invoice
   * is the request for payment, so it does. Both the office's own documents and
   * this form follow that: the quotation PDFs have no bank block at all and the
   * invoice PDFs do.
   *
   * The bank block below used to print whenever any account detail happened to
   * be filled in, so a quotation with a bank account selected printed one. HYPE
   * already gated this correctly; TNT did not.
   */
  const isInvoice = doc.docType === 'INVOICE';

  return (
    <Sheet
      headerSpace="6mm"
      /* NOTE: this does not stop body content running under the fixed footer
         artwork on documents longer than one sheet. The footer is position
         fixed at the page bottom and the artwork is 28.3mm tall, so content
         must end above 268.7mm on every page. padding-bottom only reserves
         space after the last line of the whole flow, not at the foot of each
         page, so raising this value does not move where content ends. Measured:
         the 7-row fixture still ends at 271.5mm on page 1 whether this is 18mm
         or 28.3mm. A real fix needs the space taken out of the page box itself,
         which changes where the artwork is anchored, so it is a decision and
         not a tweak. p_tnt_long exists to keep it visible. */
      footerSpace="18mm"
      /* The letterhead crop is 46mm tall: logo at 9.2-25.5mm and the title band
         at 33.2-45.9mm. This has to match the Letterhead height below or the
         print spacer is short and the body starts underneath the fixed header. */
      headerHeight="46mm"
      header={<Letterhead src={tntArt} height="46mm" edge="top" logo={<TntMark />} />}
      footer={<Letterhead src={tntArt} height="28.3mm" edge="bottom" />}
    >
      {/* No title band here. The word QUOTATION or INVOICE is part of the
          letterhead artwork, which is why there are two TNT files and the right
          one is chosen by document type. Drawing it again in CSS put a second
          band under the real one. */}

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
      <table className="w-full border-collapse text-[10px] border-x border-slate-300">
        <thead>
          <tr className="bg-slate-800 text-white print:break-after-avoid">
            <th className="px-2 py-1.5 text-left w-8">No</th>
            <th className="px-2 py-1.5 text-left border-l border-slate-400/40">Description</th>
            <th className="px-2 py-1.5 text-center w-24 border-l border-slate-400/40">Price</th>
            <th className="px-2 py-1.5 text-center w-20 border-l border-slate-400/40">Period</th>
            <th className="px-2 py-1.5 text-center w-28 border-l border-slate-400/40">Total Price</th>
          </tr>
        </thead>
        <tbody>
          {doc.items.map((it, i) => (
            <tr key={i} className="border-b border-slate-300 align-middle print:break-inside-avoid">
              <td className="px-2 py-2.5 text-center font-black">{i + 1}</td>
              <td className="px-2 py-2.5 border-l border-slate-300 align-middle">
                <div className="font-black text-[10.5px] mb-0.5">{it.title}</div>
                <Description text={it.description} />
              </td>
              {/* Price, period and total sit centred in their columns, both ways.
                  Measured off the office's own invoice, whose column rules run at
                  x 312.2 / 399.6 / 460.7 / 555.5: the price glyphs centre on
                  356.6 against a column centre of 355.9, and the total on 512.7
                  against 508.1. Vertically the row runs y 343.4 to 560.2, centre
                  451.8, and the price baseline block centres on 447.2. So the
                  paper centres them; align-top and text-right both read as a
                  spreadsheet rather than a quotation. */}
              <td className="px-2 py-2.5 text-center align-middle font-black tabular-nums whitespace-nowrap text-[10px] border-l border-slate-300">
                {rupiah(it.price)}
              </td>
              <td className="px-2 py-2.5 text-center align-middle font-black tabular-nums whitespace-nowrap text-[10px] border-l border-slate-300">
                {it.period || '-'}
              </td>
              <td className="px-2 py-2.5 text-center align-middle font-black tabular-nums whitespace-nowrap text-[10px] border-l border-slate-300">
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

      {/* Everything below the table travels as one unit.

          Terms, the totals block, the bank details and both signatures are each
          individually break-inside-avoid, but that is not the same as moving
          together: the totals could land at the foot of page one with the
          signatures orphaned onto page two, which is worse than either extreme.
          Wrapping them means a document that runs long pushes the whole closing
          section to the second sheet and leaves page one as table only.

          A single-page document is unaffected, which is the case that actually
          matters - the office's invoices do not run to two pages. */}
      <div className="print:break-inside-avoid">
        {/* terms on the left, money on the right. The totals sit on one grey
            block that starts at the page's midpoint, as on the paper - a stacked
            list of thin-bordered rows read as a spreadsheet, not a quotation. */}
        <div className="mt-4 flex gap-5 items-start">
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
          {isInvoice && (doc.bankName || doc.bankAccountName || doc.bankAccountNumber) && (
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
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// HYPE
// ---------------------------------------------------------------------------
/** Measured off the office's own PDFs, and now off the letterhead artwork. */
const LIME = '#C3E800';

/**
 * HYPE. The letterhead and the footer furniture are the office's own artwork.
 * The body was rebuilt from measurements taken off their PDFs rather than from
 * how it looked in a thumbnail, which is how the previous version ended up wrong
 * in five ways at once.
 *
 * What the PDFs actually say, and what this now does:
 *
 * - The table columns are not the same on the two document types. A quotation
 *   gives the Total column 42% and Details 30%; an invoice gives Details 48% and
 *   Total 21%, because its header is "Grand Total (Include Tax 0,5%)" on two
 *   lines. One set of widths cannot be right for both.
 * - The body cells are centred and generously padded. They were left-aligned and
 *   tight.
 * - There is no footer bar and no "Approve by" block. Both had been invented. The
 *   paper has the company name and the signatory at the bottom left, unsigned
 *   and un-underlined, and nothing else.
 *
 * The quotation prints its date in capitals ("11 SEPTEMBER 2026") and the
 * invoice does not ("15 Juni 2026"). That inconsistency is in the office's own
 * documents, so it is reproduced rather than quietly tidied up.
 */
function HypeTemplate({ doc }: { doc: PreviewDoc }) {
  const isInvoice = doc.docType === 'INVOICE';

  // Unified column proportions for both Quotation and Invoice so layout stays identical and neat.
  const columns = { pkg: '17%', details: '47%', period: '15%', total: '21%' };

  return (
    <Sheet
      /* 4.2mm, not the 8mm that was here. Measured off the office's own HYPE
         invoice: the letterhead ends at 125pt and "Official Invoice" sits at
         137pt, so the gap is 12pt. At 8mm the whole top of the document sat
         24pt low, and every line with it - number, date, the "Invoice For" line
         and the table header. */
      headerSpace="4.2mm"
      /* Reserves room so long content never runs under the fixed footer. */
      footerSpace="67mm"
      headerHeight="44.1mm"
      /* The real letterhead: the black ribbon with its notch, the lime band and
         the address, exactly as drawn. The hand-built version was measured from
         a render of this same file and still got the notch and the lime wrong. */
      header={<Letterhead src="/documents/hype-header.svg" height="44.1mm" edge="top" />}
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
                className="px-3 align-middle"
                style={{ borderLeft: '1px solid #000', padding: '6mm 4mm' }}
              >
                <div style={{ maxWidth: '68mm', margin: '0 auto' }}>
                  <RichDescription text={it.description} defaultAlign="left" textColor="text-slate-800" />
                </div>
              </td>
              <td
                className="px-3 text-center align-middle font-bold"
                style={{ borderLeft: '1px solid #000', padding: '9mm 3mm', fontSize: '10pt' }}
              >
                {it.period || '-'}
              </td>
              <td
                className="px-3 text-center align-middle font-bold"
                style={{ borderLeft: '1px solid #000', padding: '9mm 3mm', fontSize: '10pt' }}
              >
                {isInvoice && doc.taxRate !== null
                  ? rupiah(doc.grandTotal)
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

function Signatures({ doc, maroon }: { doc: PreviewDoc; maroon?: boolean }) {
  const nameColor = maroon ? MAROON_TEXT : 'text-slate-900';
  return (
    /* A grid, not two flex columns.

       The flex version aligned the two blocks with items-end, which lines up the
       bottoms. The left block has two lines, the name and the title, and the
       right has one, the name, so "RUBEN ARIANTO" sat a whole line above
       "Hibban Nazala" and the two names looked like they belonged to different
       rows. Rows in a grid are shared, so both names land in the same row and
       share a baseline regardless of what sits above them.

       "Approve by" carries self-start so it aligns with "Thank you," rather
       than with "Best Regards" below it. That is what the office does: on their
       invoice both sit at y 711.4pt, the first line of the two-line greeting.

       Spacing is set from the office's own invoice and then adjusted on the
       office's instruction. Their PDF puts 15.3mm above the greeting and 32.6mm
       above the name; the gap above was opened up and the signature gap closed,
       because that is the balance they asked for. Fixed millimetres rather than
       Tailwind steps, for the same reason the number templates are: these gaps
       have to hold at a known size on the same three paper widths. */
    <div className="mt-[18mm] print:break-inside-avoid">
      <div className="grid grid-cols-2 gap-x-8 items-end text-[9.5px]">
        <div className={`font-black ${nameColor}`}>
          Thank you,
          <br />
          Best Regards
        </div>
        <div className={`text-right font-black self-start ${nameColor}`}>
          Approve by
        </div>

        <div className="mt-[17mm] font-black underline underline-offset-2">
          {doc.signatoryName || '—'}
        </div>
        <div className="mt-[17mm] text-right font-black">
          {doc.approverName || doc.clientName || '—'}
        </div>

        <div className="font-black uppercase text-slate-500">
          {doc.signatoryTitle || '—'}
        </div>
        <div />
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
