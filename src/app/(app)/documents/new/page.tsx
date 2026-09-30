import DocumentFormClient from '@/components/documents/DocumentFormClient';
import { requireUser } from '@/lib/auth';

export default async function NewDocumentPage() {
  await requireUser();
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <DocumentFormClient />
    </div>
  );
}
