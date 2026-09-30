import DocumentsClient from '@/components/DocumentsClient';
import { requireUser } from '@/lib/auth';

/**
 * Quotation and invoice archive.
 *
 * Open to every non-pending user: issuing a document is everyday sales work.
 * Deleting one is not, and that is gated in the action by requireLord rather
 * than only by hiding the button.
 */
export default async function DocumentsPage() {
  const user = await requireUser();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <DocumentsClient user={user} />
    </div>
  );
}
