import { DocumentPreview } from "../src/components/documents/DocumentPreview";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";

const doc = {
  company: "HYPE", docType: "INVOICE", number: "04/QUO-HYPE",
  clientName: "NORTHWOOD COFFEE", issueDate: "2026-06-15", period: null,
  subtotal: 5000000, taxRate: 0.5, taxLabel: null, taxAmount: 25000,
  grandTotal: 5025125, terms: null, approverName: null,
  bankName: "Bank Central Asia", bankAccountName: "PT SYNERA KREATIF GRUP",
  bankAccountNumber: "8832372730", bankBranch: null,
  signatoryName: "Ruben Arianto", signatoryTitle: "General Manager",
  items: [{ title: "Activation\nTikTok Go",
    description: "20 Creator\n\n1 Creator Upload Min.4VT\n\n80 VT\n\nTikTok GO Campaign Strategy (from start to finish, ex: creator, brief, etc.).",
    period: "30 Days", price: 5000000 }],
};

const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="./app.css">
<style>html,body{margin:0;background:#fff}
.sheet{width:210mm;min-height:297mm;box-sizing:border-box;background:#fff}
@media print{@page{size:A4 portrait;margin:0}}</style>
<div class="sheet" id="sheet">${renderToStaticMarkup(DocumentPreview({ doc } as never))}</div>`;
writeFileSync("C:/Users/Banzilla/AppData/Local/Temp/opencode/docpreview/hype.html", html);
console.log("ok");
