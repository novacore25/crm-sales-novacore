import AdminApprovalsClient from '@/components/AdminApprovalsClient';
import { getEditRequests } from '@/app/actions/task-actions';
import { requireLordOrAdmin } from '@/lib/auth';

/**
 * Edit-request approval queue.
 *
 * The legacy page ordered by `.order('timestamp')`, which is not a column on
 * edit_requests - the column is `created_at` - so Postgres rejected the query
 * and the whole page returned a 500. It also read and wrote a phantom
 * `leads.notes` column instead of appending to `lead_notes`.
 */
export default async function AdminApprovalsPage() {
  const user = await requireLordOrAdmin();
  const requests = await getEditRequests();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <AdminApprovalsClient approvals={requests} currentUser={user} />
    </div>
  );
}
