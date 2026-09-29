import AdminUsersClient from '@/components/AdminUsersClient';
import { getUsers } from '@/app/actions/user-actions';
import { requireLordOrAdmin } from '@/lib/auth';

/**
 * User administration: approve pending staff, change roles.
 *
 * The legacy page gated on `getSession()` (unverified) and redirected
 * non-admins to `/dashboard`, which is not a route in this app - the dashboard
 * is `/`. Every non-admin landing there got a 404.
 */
export default async function AdminUsersPage() {
  const user = await requireLordOrAdmin();
  const users = await getUsers();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <AdminUsersClient initialUsers={users} currentUser={user} />
    </div>
  );
}
