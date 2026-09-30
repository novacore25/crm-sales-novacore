import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getDocument } from '@/app/actions/document-actions';
import { PrintSheet } from './PrintSheet';

/**
 * Print view. Opened in a new tab, then the user prints or saves as PDF.
 *
 * This deliberately does not build a PDF server-side. The browser's own print
 * pipeline renders the vector text and images from the same CSS the preview
 * uses, so the output is sharp and identical to what was approved - and it adds
 * no PDF library, no Chromium in the image, and no memory cost on a VPS that is
 * already tight.
 */
export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  const doc = await getDocument(id);
  if (!doc) notFound();

  return (
    <PrintSheet
      doc={{
        company: doc.company,
        docType: doc.docType,
        number: doc.number,
        clientName: doc.clientName,
        issueDate: doc.issueDate,
        period: doc.period,
        items: doc.items.map((i) => ({
          title: i.title,
          description: i.description,
          period: i.period,
          price: i.price,
        })),
        subtotal: doc.subtotal,
        taxRate: doc.taxRate,
        taxLabel: doc.taxLabel,
        taxAmount: doc.taxAmount,
        grandTotal: doc.grandTotal,
        terms: doc.terms,
        approverName: doc.approverName,
        bankName: doc.bankName,
        bankAccountName: doc.bankAccountName,
        bankAccountNumber: doc.bankAccountNumber,
        bankBranch: doc.bankBranch,
        signatoryName: doc.signatoryName,
        signatoryTitle: doc.signatoryTitle,
      }}
    />
  );
}
