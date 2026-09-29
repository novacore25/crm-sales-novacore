import LeadsClient from '@/components/LeadsClient';
import { getLeadsPage } from '@/app/actions/lead-actions';
import { getUsers } from '@/app/actions/user-actions';
import { requireUser } from '@/lib/auth';

/**
 * Leads database.
 *
 * The legacy page loaded every lead into the browser with a `while (hasMore)`
 * loop over `.range(page*1000, ...)`, pulling 3-5 MB of JSON on each visit.
 * Worse, the range query had no ORDER BY, so rows could be skipped or repeated
 * whenever the table changed mid-scan.
 *
 * The list now renders the first page server-side and the client paginates
 * against the server action on demand, with a stable ORDER BY and a matching
 * COUNT for the total.
 */
export default async function LeadsPage() {
  const user = await requireUser();

  const [{ leads, total }, users] = await Promise.all([
    getLeadsPage({ page: 0, pageSize: 50, includeDeleted: false }),
    getUsers(),
  ]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <LeadsClient
        initialLeads={leads}
        initialTotal={total}
        user={user}
        users={users}
        approvals={[]}
      />
    </div>
  );
}
