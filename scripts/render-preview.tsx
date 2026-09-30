import { DocumentPreview } from "../src/components/documents/DocumentPreview";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";

const base = {
  number: "038/QUO-TNT/SA/IX/26",
  clientName: "PT L'OREAL INDONESIA",
  issueDate: "2026-09-29",
  period: null,
  subtotal: 50000000,
  taxRate: 11,
  taxLabel: "PPN",
  taxAmount: 5500000,
  grandTotal: 55500000,
  terms: "Payment 100% before the project start\nAll price above already include the KOL cost\nProject should be prepare 14 days before the campaign running",
  approverName: "L'Oreal Indonesia",
  bankName: "BCA",
  bankAccountName: "PT TNT KREATIF DIGITAL AL",
  bankAccountNumber: "7613472888",
  bankBranch: "KARAWACI",
  signatoryName: "RUBEN ARIANTO",
  signatoryTitle: "DIREKTUR",
  items: [
    {
      title: "Affiliate Booster",
      description:
        "1.500 creators (VT Concept & Quantity will be adjust by Thick & Thin Media)\n- Upload 1.500 VT with Yellow Cart\n- Tier Creator\n  - Mega 1\n  - Macro 15\n  - Micro 124\n  - Nano 360\n- SOW per creator 3 video by Thick & Thin Media",
      period: "30 Days",
      price: 50000000,
    },
  ],
};

const docs: Record<string, unknown> = {
  p_tnt: { ...base, company: "TNT", docType: "QUOTATION" },
  p_hype: {
    ...base,
    company: "HYPE",
    docType: "INVOICE",
    number: "005/INV-HYPE",
    bankAccountName: "PT SYNERA KREATIF GRUP",
    bankAccountNumber: "8832372730",
    bankBranch: null,
    signatoryTitle: "General Manager",
  },
};

for (const [slug, doc] of Object.entries(docs)) {
  writeFileSync(
    `C:/Users/Banzilla/AppData/Local/Temp/opencode/docpreview/${slug}.html`,
    `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="./app.css">
<style>
  html,body{margin:0;background:#fff}
  .sheet{width:210mm;min-height:297mm;box-sizing:border-box;background:#fff}
  @media print{
    @page{size:A4 portrait;margin:0}
    .sheet{width:210mm}
  }
</style>
<div class="sheet">${renderToStaticMarkup(DocumentPreview({ doc } as never))}</div>`,
  );
}
console.log("HTML written with real Tailwind CSS");
