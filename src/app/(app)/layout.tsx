import { redirect } from 'next/navigation';

import AppLayout from '@/components/AppLayout';
import PendingScreen from '@/components/PendingScreen';
import { getCurrentUser } from '@/lib/auth';
import { toProfile } from '@/lib/auth-users';
import { countPendingUsersSafe } from '@/app/actions/user-actions';

/**
 * Layout for the authenticated application shell.
 *
 * The legacy root layout did a lot here: it built a Supabase client, called
 * `auth.getUser()`, looked up the user row, and auto-registered unknown
 * accounts with an INSERT into `users`. That meant every single page render
 * performed authentication and could perform a write - and because the layout
 * used `insert` while the pages used `upsert`, two concurrent first logins
 * could collide on the unique email constraint and throw inside the root
 * layout.
 *
 * Registration now happens exactly once, in the Auth.js `signIn` callback.
 * The layout only reads. Splitting it into this route group also means
 * /login and /pending skip the shell entirely instead of being wrapped in it.
 */
export default async function AppLayoutRoute({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // The middleware already redirects unauthenticated requests; this guards
  // against direct RSC invocation and against a session that was revoked
  // between the middleware pass and this render.
  if (!user) {
    redirect('/login');
  }

  if (user.role === 'pending') {
    return <PendingScreen email={user.email} name={user.name} />;
  }

  const pendingUsersCount = await countPendingUsersSafe();

  return (
    <AppLayout user={toProfile(user)} pendingUsersCount={pendingUsersCount}>
      {children}
    </AppLayout>
  );
}
