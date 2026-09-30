import DocumentDetailClient from '@/components/documents/DocumentDetailClient';
import { requireUser } from '@/lib/auth';

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <DocumentDetailClient id={id} user={user} />
    </div>
  );
}
