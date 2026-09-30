import { DocumentPreview, type PreviewDoc } from "../src/components/documents/DocumentPreview";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync, copyFileSync } from "node:fs";

const out = "C:/Users/Banzilla/AppData/Local/Temp/opencode/docpreview/documents";
copyFileSync("public/documents/tnt-quotation.svg", `${out}/tnt-quotation.svg`);
copyFileSync("public/documents/tnt-invoice.svg", `${out}/tnt-invoice.svg`);
copyFileSync("public/documents/hype-header.svg", `${out}/hype-header.svg`);
copyFileSync("public/documents/logo-tnt-mark.png", `${out}/logo-tnt-mark.png`);
writeFileSync("C:/Users/Banzilla/AppData/Local/Temp/opencode/docpreview/.gitkeep", "");

const tnt: PreviewDoc = {
  company: "TNT", docType: "QUOTATION", number: "038/QUO-TNT/SA/IX/26",
  clientName: "PT L'OREAL INDONESIA", issueDate: "2026-09-29", period: null,
  subtotal: 50000000, taxRate: 11, taxLabel: "PPN", taxAmount: 5500000,
  grandTotal: 55500000,
  terms: "Payment 100% before the project start\nAll price above already include the KOL cost",
  approverName: "L'Oreal Indonesia", bankName: "BCA",
  bankAccountName: "PT TNT KREATIF DIGITAL AL", bankAccountNumber: "7613472888",
  bankBranch: "KARAWACI", signatoryName: "RUBEN ARIANTO", signatoryTitle: "DIREKTUR",
  items: [{ title: "Affiliate Booster",
    description: "1.500 creators\n- Upload 1.500 VT with Yellow Cart\n- Tier Creator\n  - Mega 1\n  - Macro 15",
    period: "30 Days", price: 50000000 }],
};
const hype: PreviewDoc = {
  ...tnt, company: "HYPE", docType: "INVOICE", number: "04/QUO-HYPE",
  clientName: "NORTHWOOD COFFEE", issueDate: "2026-06-15",
  subtotal: 5000000, taxRate: 0.5, taxLabel: null, taxAmount: 25000, grandTotal: 5025000,
  terms: null, approverName: null, bankName: "Bank Central Asia",
  bankAccountName: "PT SYNERA KREATIF GRUP", bankAccountNumber: "8832372730",
  bankBranch: null, signatoryName: "Ruben Arianto", signatoryTitle: "General Manager",
  items: [{ title: "Activation\nTikTok Go",
    description: "20 Creator\n\n1 Creator Upload Min.4VT\n\n80 VT",
    period: "30 Days", price: 5000000 }],
};

const css = `body{margin:0;background:#fff}.sheet{width:210mm;min-height:297mm;box-sizing:border-box;background:#fff}
@media print{@page{size:A4 portrait;margin:0}}`;
for (const [slug, doc] of [["p_tnt", tnt], ["p_hype", hype]] as const) {
  writeFileSync(`C:/Users/Banzilla/AppData/Local/Temp/opencode/docpreview/${slug}.html`,
    `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./app.css">
<style>${css}</style><div class="sheet">${renderToStaticMarkup(DocumentPreview({ doc }))}</div>`);
}
console.log("ok");
