import { DocumentPreview, type PreviewDoc } from "../src/components/documents/DocumentPreview";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync, copyFileSync } from "node:fs";

const out = "C:/Users/Banzilla/AppData/Local/Temp/opencode/docpreview/documents";
for (const f of ["tnt-quotation.svg","tnt-invoice.svg","hype-header.svg","logo-tnt-mark.png"])
  copyFileSync(`public/documents/${f}`, `${out}/${f}`);

const base: PreviewDoc = {
  company: "TNT", docType: "QUOTATION", number: "038/QUO-TNT/SA/IX/26",
  clientName: "PT L'OREAL INDONESIA", issueDate: "2026-09-29", period: null,
  subtotal: 50000000, taxRate: 11, taxLabel: "PPN", taxAmount: 5500000, grandTotal: 55500000,
  terms: "Payment 100% before the project start", approverName: "Hibban Nazala",
  bankName: "BCA", bankAccountName: "PT TNT KREATIF DIGITAL AL",
  bankAccountNumber: "7613472888", bankBranch: "KARAWACI",
  signatoryName: "RUBEN ARIANTO", signatoryTitle: "DIREKTUR",
  items: [{ title: "Affiliate Booster", description: "1.500 creators", period: "30 Days", price: 50000000 }],
};

const css = `body{margin:0;background:#fff}.sheet{width:210mm;min-height:297mm;box-sizing:border-box}
@media print{@page{size:A4 portrait;margin:0}}`;
for (const [slug, doc] of [
  ["r_tnt_quo", { ...base, docType: "QUOTATION", number: "038/QUO-TNT/SA/IX/26" }],
  ["r_tnt_inv", { ...base, docType: "INVOICE",   number: "01/INV-TNT/MCN/VIII/26" }],
] as const) {
  writeFileSync(`C:/Users/Banzilla/AppData/Local/Temp/opencode/docpreview/${slug}.html`,
    `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./app.css">
<style>${css}</style><div class="sheet">${renderToStaticMarkup(DocumentPreview({ doc }))}</div>`);
}
console.log("ok");
