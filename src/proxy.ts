import { NextResponse, type NextRequest } from 'next/server';

import { auth } from '@/auth';

/**
 * Route protection.
 *
 * Replaces the Supabase session check that ran on every request just to decide
 * whether to redirect. Auth.js reads the session cookie locally, so the check
 * does not need a network round trip.
 *
 * Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts`. The
 * rename is not cosmetic: Proxy runs on the **Node.js** runtime by default
 * (and rejects an explicit `runtime` config), which is what allows this file to
 * import the Auth.js config that reaches the database through `pg`. Under the
 * Edge runtime that import fails to resolve.
 *
 * Two behaviours changed deliberately:
 *
 *  1. `pending` users are redirected to /pending. The previous middleware let
 *     them through every route and relied on each page to bail out; several
 *     pages did not, so a pending account could read data it should not see.
 *
 *  2. /admin/* and /permissions are gated here by role. Previously
 *     /permissions had no server-side check at all - the nav link was merely
 *     hidden, so any authenticated user could type the URL directly.
 *
 * These are optimistic checks on a signed cookie. They improve UX by avoiding
 * a render the user was never allowed to see. The real boundary is in
 * `src/lib/auth.ts`: every page calls `requireUser()` and every server action
 * re-checks permissions against the database.
 */
export async function proxy(request: NextRequest) {
  const session = await auth();
  const { pathname } = request.nextUrl;

  const isLoginRoute = pathname === '/login';
  const isAuthRoute = pathname.startsWith('/api/auth');

  if (!session?.user) {
    if (isLoginRoute || isAuthRoute) {
      return NextResponse.next();
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }

  if (isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Role checks for the admin surface. The role is read from the session
  // cookie, which is signed; it is still re-verified against the database
  // inside each server action before anything is written.
  const role = (session.user as { role?: string }).role;

  if (pathname.startsWith('/admin') && role !== 'admin' && role !== 'lord') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (pathname === '/permissions' && role !== 'lord') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (role === 'pending' && !pathname.startsWith('/pending')) {
    const url = request.nextUrl.clone();
    url.pathname = '/pending';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (role && role !== 'pending' && pathname.startsWith('/pending')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
