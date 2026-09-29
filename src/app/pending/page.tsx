import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth';
import PendingScreen from '@/components/PendingScreen';

/**
 * Landing page for accounts awaiting approval.
 *
 * `pending` users are authenticated but have no access to any CRM data. The
 * middleware sends them here, and this page confirms their identity while
 * offering a sign-out.
 */
export default async function PendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'pending') redirect('/');

  return <PendingScreen email={user.email} name={user.name} />;
}
