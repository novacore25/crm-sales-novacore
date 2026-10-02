import DashboardClient from '@/components/DashboardClient';
import { getDashboardStats, getGhostedLeads, getIndividualContributions } from '@/app/actions/analytics-actions';
import { getUsers } from '@/app/actions/user-actions';
import { getMilestoneTargets, getIndividualTargets } from '@/app/actions/target-actions';
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
 *
 * The bars on this page are measured against per-rep targets, never against a
 * company figure, so the only thing needed from the company level is whether a
 * target exists for the month - which now means the per-product milestones.
 * That check used to read `global_targets` and therefore reported "no target set"
 * on a month whose milestones were fully set, because the two were never
 * reconciled.
 */
export default async function DashboardPage() {
  const user = await requireUser();

  const [stats, contributions, ghosted, users, milestones, individualTargets] = await Promise.all([
    getDashboardStats({}),
    getIndividualContributions({}),
    getGhostedLeads({}),
    getUsers(),
    getMilestoneTargets(),
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
        milestones={milestones}
        individualTargets={individualTargets}
      />
    </div>
  );
}
