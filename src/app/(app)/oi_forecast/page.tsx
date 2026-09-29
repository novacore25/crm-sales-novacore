import OIForecastClient from '@/components/OIForecastClient';
import { getOIForecasts } from '@/app/actions/forecast-actions';
import { getOITargets } from '@/app/actions/target-actions';
import { getUsers } from '@/app/actions/user-actions';
import { requireUser } from '@/lib/auth';

/**
 * Operational Income forecast.
 *
 * The legacy page embedded `funnel_history(*)` across every lead just to
 * resolve the latest stage per forecast row, and had no `pending` role check,
 * so an unapproved account could reach it.
 */
export default async function OIForecastPage() {
  const user = await requireUser();

  const [forecasts, targets, users] = await Promise.all([
    getOIForecasts(),
    getOITargets(),
    getUsers(),
  ]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <OIForecastClient forecasts={forecasts} targets={targets} users={users} user={user} />
    </div>
  );
}
