import { notFound, redirect } from 'next/navigation';
import DocumentFormClient, { type DocumentFormSeed } from '@/components/documents/DocumentFormClient';
import { getDocument } from '@/app/actions/document-actions';
import { requireUser } from '@/lib/auth';

/**
 * Edit an existing draft.
 *
 * Only DRAFT is editable, and the check is here as well as in updateDocument.
 * The action is still the control - this only stops the user filling in a form
 * that is guaranteed to be rejected on save, which reads as a bug rather than as
 * a rule.
 *
 * A published document is not silently copied into a new draft either. Making a
 * revision is a deliberate act with its own number, and quietly forking one here
 * would produce two documents with the same content and different numbers
 * without anyone having chosen that.
 */
export default async function EditDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  const doc = await getDocument(id);
  if (!doc) notFound();
  if (doc.status !== 'DRAFT') redirect(`/documents/${id}`);

  const seed: DocumentFormSeed = {
    id: doc.id,
    seriesId: doc.seriesId,
    number: doc.number,
    clientName: doc.clientName,
    issueDate: doc.issueDate,
    period: doc.period,
    // The form holds text; the columns come back as numbers. Converting here
    // keeps the money columns from being reformatted by the browser's number
    // input handling - a price of 100000000 must not become 100,000,000.
    taxRate: doc.taxRate === null ? null : String(doc.taxRate),
    taxLabel: doc.taxLabel,
    terms: doc.terms,
    approverName: doc.approverName,
    bankName: doc.bankName,
    bankAccountName: doc.bankAccountName,
    bankAccountNumber: doc.bankAccountNumber,
    bankBranch: doc.bankBranch,
    signatoryName: doc.signatoryName,
    signatoryTitle: doc.signatoryTitle,
    items: doc.items.map((i) => ({
      title: i.title,
      description: i.description ?? '',
      period: i.period ?? '',
      price: String(i.price),
    })),
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <DocumentFormClient seed={seed} />
    </div>
  );
}
