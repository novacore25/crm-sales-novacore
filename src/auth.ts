import NextAuth from 'next-auth';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import Google from 'next-auth/providers/google';

import { db } from '@/db';
import { ensurePendingUser, findUserByEmail, findUserById } from '@/lib/auth-users';
import { accounts, sessions, verificationTokens } from '@/db/auth-schema';
import { users } from '@/db/schema';

/**
 * Auth.js (NextAuth v5) configuration.
 *
 * Replaces Supabase Auth. The user-visible flow is deliberately identical to the
 * old app: press "Lanjutkan dengan Google", land back on the CRM. Only the
 * plumbing changed.
 *
 * The `signIn` callback auto-registers unknown Google accounts with the
 * `pending` role, matching the behaviour the root layout used to perform. A
 * `pending` user is signed in but the app renders <PendingScreen /> instead of
 * the application, and an admin promotes them from /admin/users.
 *
 * Authorization does NOT happen here. This file only establishes identity;
 * every server action independently re-checks permissions against the database.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  /**
   * The Drizzle adapter stores accounts and sessions in the same Postgres that
   * holds the CRM data. `users` is passed explicitly because Auth.js expects
   * `id / name / email / emailVerified / image`, while our table has
   * `id / email / name / role`. The extra columns are untouched.
   *
   * User rows themselves are NOT created by the adapter - see the `signIn`
   * callback below, which owns registration so that the role is always set
   * explicitly rather than relying on a column default.
   */
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  callbacks: {
    /**
     * Registration happens here, once, in the place that already has the
     * verified Google profile.
     *
     * The legacy root layout did this on every render with an INSERT, while
     * the pages did it with an UPSERT - so two concurrent first logins could
     * collide on the unique email constraint and throw inside the root layout.
     */
    async signIn({ user, account, profile }) {
      if (account?.provider !== 'google') return false;
      if (!user?.email) return false;

      const existing = await findUserByEmail(user.email);
      if (!existing) {
        await ensurePendingUser(user.email, user.name ?? profile?.name ?? '');
      }
      return true;
    },

    /**
     * Attach the internal id and current role to the session so middleware can
     * gate routes without a second database round trip, and so server actions
     * can query by primary key.
     */
    async session({ session, user }) {
      if (session.user) {
        const row = user?.id
          ? await findUserById(user.id)
          : session.user.email
            ? await findUserByEmail(session.user.email)
            : null;

        if (row) {
          const enriched = session.user as unknown as { id: string; role: string };
          enriched.id = row.id;
          enriched.role = row.role;
          session.user.name = row.name;
        }
      }
      return session;
    },
  },
  session: {
    /**
     * Database-backed sessions, not JWTs. The role changes when an admin
     * approves a user, and a JWT would keep serving the stale role from the
     * cookie until it expired.
     */
    strategy: 'database',
    maxAge: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  trustHost: true,
  secret: process.env.AUTH_SECRET,
});
