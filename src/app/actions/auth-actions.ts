'use server';

import { signIn, signOut } from '@/auth';

/**
 * Thin server-action wrappers around the Auth.js helpers.
 *
 * Client components must import these, not `@/auth` directly. `@/auth` builds
 * the Drizzle adapter at module scope, so importing it from a client component
 * pulls `pg` — and Node built-ins it depends on — into the browser bundle and
 * the build fails.
 *
 * The `'use server'` directive turns each export into a server reference: the
 * client receives a proxy function, and the implementation stays on the server.
 */
export async function loginWithGoogle(): Promise<void> {
  await signIn('google', { redirectTo: '/' });
}

export async function logout(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
