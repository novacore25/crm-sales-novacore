'use client';

import { useEffect } from 'react';
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
 * a layout change lands in both. The preview is deliberately scaled down on
 * screen; this is the real size.
 */
export function PrintSheet({ doc }: { doc: PreviewDoc }) {
  useEffect(() => {
    // Give the layout a frame before the print dialog opens, or the first
    // print can capture a half-painted page.
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        @media print {
          html, body { margin: 0; padding: 0; background: #fff; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-hide { display: none !important; }
        }
      `}</style>

      <div className="min-h-screen bg-slate-200 print:bg-white flex flex-col items-center py-6 print:py-0">
        <div className="print-hide mb-4 flex items-center gap-3">
          <button
            onClick={() => window.close()}
            className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-[11px] font-black uppercase tracking-widest shadow"
          >
            Tutup
          </button>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[11px] font-black uppercase tracking-widest shadow"
          >
            Print / Save as PDF
          </button>
          <span className="text-[11px] text-slate-500 font-bold">
            Pilih &quot;Save as PDF&quot; sebagai destination
          </span>
        </div>

        <div className="w-[210mm] min-h-[297mm] bg-white shadow-lg print:shadow-none print:w-full print:min-h-0">
          <DocumentPreview doc={doc} />
        </div>
      </div>
    </>
  );
}
