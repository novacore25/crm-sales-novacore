'use client';

import { useRouter } from 'next/navigation';
import { DocumentPreview, type PreviewDoc } from '@/components/documents/DocumentPreview';

/**
 * The printable page.
 *
 * `@page { size: A4; margin: 0 }` is the part that matters. With a default
 * margin the browser shrinks the content to fit inside a smaller printable
 * box, so the document comes out with a border of white and a scale that does
 * not match the preview. Zero margin plus `-webkit-print-color-adjust: exact`
 * gives edge-to-edge colour - without that, Chrome drops the maroon and lime
 * backgrounds and the document prints as a grey page.
 *
 * The same `DocumentPreview` component the screen preview uses renders here, so
 * a layout change lands in both.
 *
 * This used to open the print dialog by itself 300ms after load. It was wrong
 * for the main way this page is reached: checking whether a draft's layout is
 * right before publishing it. A dialog that fires unasked blocks that, and it
 * fires before the page has finished painting, so the first print could capture
 * a half-drawn sheet. Printing is now a deliberate click.
 *
 * The banner distinguishes a draft with no number from one that has it, because
 * a draft can now carry the number the user typed into the form. Telling someone
 * their draft has no number when it plainly has one is worse than saying
 * nothing.
 */
export function PrintSheet({ doc }: { doc: PreviewDoc }) {
  const router = useRouter();

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        @media print {
          html, body { margin: 0; padding: 0; background: #fff; }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            width: 210mm;
          }
          .print-hide { display: none !important; }
          table { border-collapse: collapse; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
        }
      `}</style>

      <div className="min-h-screen bg-slate-200 print:bg-white flex flex-col items-center py-6 print:py-0">
        <div className="print-hide mb-4 flex items-center gap-3">
          {/* router.back, not window.close: this page is reached by a normal
              navigation, so there is no script-opened window for close() to
              close and the button would do nothing. */}
          <button
            onClick={() => router.back()}
            className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-[11px] font-black uppercase tracking-widest shadow"
          >
            Kembali
          </button>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[11px] font-black uppercase tracking-widest shadow"
          >
            Print / Save as PDF
          </button>
          <span className="text-[11px] text-slate-500 font-bold">
            Destination pilih <strong>&quot;Save as PDF&quot;</strong> &middot; paper A4 &middot;
            margins <strong>None</strong> &middot; aktifkan <strong>Background graphics</strong>
          </span>
        </div>

        {!doc.number ? (
          <div className="print-hide mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-[11px] font-bold text-amber-800">
            Ini masih DRAFT dan nomornya belum diisi. Kalau Anda sudah tahu nomornya, isi di
            form editable &mdash; layout di bawah tidak akan berubah, hanya baris nomornya.
          </div>
        ) : (
          <div className="print-hide mb-4 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-[11px] font-bold text-slate-600">
            Nomor <strong className="text-slate-900">{doc.number}</strong> sudah ada di draft
            ini. Layout di bawah sama persis dengan yang akan keluar setelah diterbitkan.
          </div>
        )}

        <div className="w-[210mm] min-h-[297mm] bg-white shadow-lg print:shadow-none print:w-[210mm] print:min-h-0">
          <DocumentPreview doc={doc} />
        </div>
      </div>
    </>
  );
}
