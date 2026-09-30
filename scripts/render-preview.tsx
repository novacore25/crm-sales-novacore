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
      description: "1.500 creators (VT Concept & Quantity will be adjust by Thick & Thin Media)\n- Upload 1.500 VT with Yellow Cart\n- Tier Creator\n  - Mega 1\n  - Macro 15\n  - Micro 124\n  - Nano 360\n- SOW per creator 3 video by Thick & Thin Media",
      period: "30 Days",
      price: 50000000,
    },
  ],
};

const tnt = renderToStaticMarkup(
  DocumentPreview({ doc: { ...base, company: "TNT", docType: "QUOTATION" } } as never),
);
const hype = renderToStaticMarkup(
  DocumentPreview({
    doc: {
      ...base,
      company: "HYPE",
      docType: "INVOICE",
      number: "005/QUO-HYPE",
      bankAccountName: "PT SYNERA KREATIF GRUP",
      bankAccountNumber: "8832372730",
      bankBranch: null,
      signatoryTitle: "General Manager",
    },
  } as never),
);

const css = `body{margin:0;background:#fff;font-family:Helvetica,Arial,sans-serif}
.sheet{width:794px;min-height:1123px;overflow:hidden;box-sizing:border-box;background:#fff}
@media print{@page{size:A4 portrait;margin:0}}`;

writeFileSync(
  "C:/Users/Banzilla/AppData/Local/Temp/opencode/docpreview/p_tnt.html",
  `<style>${css}</style><div class="sheet">${tnt}</div>`,
);
writeFileSync(
  "C:/Users/Banzilla/AppData/Local/Temp/opencode/docpreview/p_hype.html",
  `<style>${css}</style><div class="sheet">${hype}</div>`,
);
console.log("HTML written");
