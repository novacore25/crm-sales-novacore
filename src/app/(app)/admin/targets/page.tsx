import AdminTargetsClient from '@/components/AdminTargetsClient';
import { getGlobalTargets, getIndividualTargets } from '@/app/actions/target-actions';
import { getUsers } from '@/app/actions/user-actions';
import { requireLordOrAdmin } from '@/lib/auth';

/**
 * Target administration: company-wide and per-staff monthly targets.
 *
 * The legacy page read per-staff targets from `oi_targets` - the per-product OI
 * table - using a mapper written for `global_targets`, so every field came back
 * undefined and the UI rendered blanks and NaN.
 */
export default async function AdminTargetsPage() {
  const user = await requireLordOrAdmin();

  const [globalTargets, individualTargets, users] = await Promise.all([
    getGlobalTargets(),
    getIndividualTargets(),
    getUsers(),
  ]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <AdminTargetsClient
        initialGlobalTargets={globalTargets}
        initialIndividualTargets={individualTargets}
        users={users}
        currentUser={user}
      />
    </div>
  );
}
