import DocumentFormClient, { type DocumentFormSeed } from '@/components/documents/DocumentFormClient';
import { getDocument, getDocumentSeries } from '@/app/actions/document-actions';
import { requireUser } from '@/lib/auth';

export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams?: Promise<{ fromQuotationId?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  let seed: DocumentFormSeed | undefined = undefined;

  if (params?.fromQuotationId) {
    const quo = await getDocument(params.fromQuotationId);
    if (quo) {
      const seriesList = await getDocumentSeries();
      const invoiceSeries = seriesList.find(
        (s) => s.company === quo.company && s.docType === 'INVOICE' && s.isActive,
      );

      seed = {
        id: '',
        isCopy: true,
        seriesId: invoiceSeries ? invoiceSeries.id : quo.seriesId,
        number: null,
        clientName: quo.clientName,
        clientAddress: quo.clientAddress ?? null,
        issueDate: new Date().toISOString().slice(0, 10),
        period: quo.period,
        taxRate: quo.taxRate === null ? null : String(quo.taxRate),
        taxLabel: quo.taxLabel,
        terms: quo.terms,
        approverName: quo.approverName,
        bankName: null,
        bankAccountName: null,
        bankAccountNumber: null,
        bankBranch: null,
        signatoryName: null,
        signatoryTitle: null,
        items: quo.items.map((i) => ({
          title: i.title,
          description: i.description ?? '',
          period: i.period ?? '',
          price: String(i.price),
        })),
      };
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <DocumentFormClient seed={seed} />
    </div>
  );
}
