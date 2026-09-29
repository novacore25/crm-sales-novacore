import PermissionSettingsClient from '@/components/PermissionSettingsClient';
import { requireLord } from '@/lib/auth';

/**
 * Role permission matrix.
 *
 * The legacy page was six lines with no auth, no imports and no data access;
 * access was "protected" only by the sidebar hiding its nav link, so any
 * authenticated user could type /permissions directly. Its save handler was a
 * `setTimeout` stub and `role_permissions` was never read or written anywhere
 * in the codebase - the whole feature was inert.
 *
 * It is now gated in the middleware and in this page, and the matrix is
 * enforced in `src/lib/permissions.ts` on the server.
 */
export default async function PermissionsPage() {
  const user = await requireLord();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <PermissionSettingsClient currentUser={user} />
    </div>
  );
}
