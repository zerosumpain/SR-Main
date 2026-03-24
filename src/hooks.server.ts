import { startScheduler } from '$lib/health/scheduler';
import { orchestrator } from '$lib/jkai/orchestrator';
import { isPublicPath } from '$lib/auth';
import { SvelteKitAuth } from '@auth/sveltekit';
import Google from '@auth/sveltekit/providers/google';
import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { env } from '$env/dynamic/private';

// Start the health data sync scheduler
startScheduler();

// Recover any in-progress builds on server startup
orchestrator.recoverOnStartup().catch((err) => {
  console.error('[jkai] Failed to recover build on startup:', err);
});

// Allowed email addresses
function getAllowedEmails(): string[] {
  const emails = env.AUTH_ALLOWED_EMAILS || '';
  return emails.split(',').map((e) => e.trim()).filter(Boolean);
}

// Auth.js handler
const { handle: authHandle } = SvelteKitAuth({
  providers: [
    Google({
      clientId: env.GOOGLE_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  secret: env.AUTH_SECRET,
  trustHost: true,
  callbacks: {
    async signIn({ user, profile }) {
      const allowed = getAllowedEmails();
      if (allowed.length === 0) return true;
      const email = user?.email || (profile as any)?.email || '';
      console.log(`[auth] Sign-in attempt: ${email} (allowed: ${allowed.join(',')})`);
      return allowed.includes(email);
    },
    async session({ session }) {
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/auth-error',
  },
});

// Route protection
const protectionHandle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;

  if (isPublicPath(pathname)) {
    return resolve(event);
  }

  // API routes return 401
  if (pathname.startsWith('/api/')) {
    const session = await event.locals.auth();
    if (!session?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return resolve(event);
  }

  // Page routes redirect to sign-in
  const session = await event.locals.auth();
  if (!session?.user) {
    const callbackUrl = encodeURIComponent(pathname + event.url.search);
    throw redirect(302, `/login?callbackUrl=${callbackUrl}`);
  }

  return resolve(event);
};

export const handle = sequence(authHandle, protectionHandle);
