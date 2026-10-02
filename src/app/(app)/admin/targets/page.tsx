import AdminTargetsClient from '@/components/AdminTargetsClient';
import { getIndividualTargets, getMilestoneTargets } from '@/app/actions/target-actions';
import { getUsers } from '@/app/actions/user-actions';
import { requireLordOrAdmin } from '@/lib/auth';

/**
 * Target administration.
 *
 * The GLOBAL tab is read-only and made of the per-product milestone targets,
 * because that is where the company revenue target is actually maintained. It
 * used to be a form writing to `global_targets`, which held one figure per month
 * with no product breakdown - so it could not express a target split across TNT,
 * MCN and HYPE, and it duplicated the milestones under a second name. Two places
 * answering the same question is how the two drifted apart in the first place.
 *
 * The INDIVIDUAL tab is the only place anything is written. An individual's
 * revenue target is deliberately free of the milestone: the company may aim one
 * rep well past the team figure, so nothing here derives from, prorates against
 * or caps at the milestone.
 *
 * The legacy page read per-staff targets from `oi_targets` - the per-product OI
 * table - using a mapper written for `global_targets`, so every field came back
 * undefined and the UI rendered blanks and NaN.
 */
export default async function AdminTargetsPage() {
  const user = await requireLordOrAdmin();

  const [milestones, individualTargets, users] = await Promise.all([
    getMilestoneTargets(),
    getIndividualTargets(),
    getUsers(),
  ]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <AdminTargetsClient
        milestones={milestones}
        initialIndividualTargets={individualTargets}
        users={users}
        currentUser={user}
      />
    </div>
  );
}
