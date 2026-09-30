// Harness for PreviewPane: reproduces the pane's DOM contract (scroller with
// overflow-auto, sheet at A4 size with CSS zoom) so the sticky header/footer and
// the zoom can be checked in a real browser. PreviewPane itself is a client
// component with hooks, so it is exercised through the page rather than here.
import { DocumentPreview, type PreviewDoc } from '../src/components/documents/DocumentPreview';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';

const doc: PreviewDoc = {
  company: 'TNT',
  docType: 'QUOTATION',
  number: '038/QUO-TNT/SA/IX/26',
  clientName: 'PT L\u2019OREAL INDONESIA',
  issueDate: '2026-09-29',
  period: null,
  subtotal: 168000000,
  taxRate: 12,
  taxLabel: 'PPN',
  taxAmount: 20160000,
  grandTotal: 188160000,
  terms:
    'Payment 100% before the project start\nAll price above already include the KOL cost\nProject should be prepare 14 days before the campaign running',
  approverName: 'Hibban Nazala',
  bankName: 'BCA',
  bankAccountName: 'PT TNT KREATIF DIGITAL AL',
  bankAccountNumber: '7613472888',
  bankBranch: 'KARAWACI',
  signatoryName: 'RUBEN ARIANTO',
  signatoryTitle: 'DIREKTUR',
  // Deliberately long: forces the sheet taller than the pane so that the
  // sticky header and footer have something to stay put against.
  items: [
    {
      title: 'Affiliate Booster',
      description:
        '1.500 creators (VT Concept & Quantity will be adjust by Thick & Thin Media)\n- Upload 1.500 VT with Yellow Cart\n- Tier Creator\n  - Mega 1\n  - Macro 15\n  - Micro 124\n  - Nano 360\n- SOW per creator 3 video by Thick & Thin Media',
      period: '30 Days',
      price: 100000000,
    },
    {
      title: 'x d d d',
      description: 'dd d dsgfsvgsevsvsdvdvd',
      period: '30 days',
      price: 30000000,
    },
    {
      title: 'Live Streaming Exclusive Creator MCN',
      description:
        'Username creator: im.randia\nSesi: 4 (durasi 2 jam)\nTaggal: 8, 12, 13, 14 Agustus 2026\nLive akan dimulai pada tanggal yang disrespecti pukul 13.00-15.00\nBenefit Creator dari Brand Garnier:\n- Exclusive Voucher\n- Live Ads Support\n- Product Seeding ( Upon request )\n- Exclusive PID (*upon request)\n- Exclusive Live Activations',
      period: '4 Sesi',
      price: 38000000,
    },
  ],
};

const sheet = renderToStaticMarkup(DocumentPreview({ doc }));

const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="./app.css">
<style>
  html,body{margin:0;background:#fff}
  /* Mirrors the pane: a fixed-height scroller holding one A4 sheet. */
  .pane{width:820px;height:760px;overflow:auto;background:#e2e8f0;padding:16px;box-sizing:border-box}
  .sheet{margin:0 auto;background:#fff;box-shadow:0 10px 15px -3px rgb(0 0 0 / .1);width:794px;min-height:1123px}
  .sheet.zoomed{zoom:1.25}
  @media print{@page{size:A4 portrait;margin:0}}
</style>
<div class="pane" id="pane">
  <div class="sheet${process.env.ZOOM === '1' ? ' zoomed' : ''}" id="sheet">${sheet}</div>
</div>`;

writeFileSync('C:/Users/Banzilla/AppData/Local/Temp/opencode/docpreview/pane.html', html);
console.log('pane harness written');
