import DashboardClient from '@/components/DashboardClient';
import { getDashboardStats, getGhostedLeads, getIndividualContributions } from '@/app/actions/analytics-actions';
import { getUsers } from '@/app/actions/user-actions';
import { getGlobalTargets, getIndividualTargets } from '@/app/actions/target-actions';
import { requireUser } from '@/lib/auth';

/**
 * Dashboard (Leads Pipeline).
 *
 * All data is resolved on the server and handed to the client component as
 * props. The legacy page created its own Supabase client in the component
 * body - meaning the database was contacted again on the client after the
 * server had already rendered - and passed `leads={[]}` because fetching all
 * 6,000 rows on every dashboard load was deemed too expensive.
 *
 * Stats come from one aggregate query instead, which is both faster and
 * smaller than shipping the dataset to the browser to count it there.
 */
export default async function DashboardPage() {
  const user = await requireUser();

  const [stats, contributions, ghosted, users, targets, individualTargets] = await Promise.all([
    getDashboardStats({}),
    getIndividualContributions({}),
    getGhostedLeads({}),
    getUsers(),
    getGlobalTargets(),
    getIndividualTargets(),
  ]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <DashboardClient
        stats={stats}
        contributions={contributions}
        ghosted={ghosted}
        user={user}
        users={users}
        targets={targets}
        individualTargets={individualTargets}
      />
    </div>
  );
}
