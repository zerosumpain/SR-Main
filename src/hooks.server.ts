import { startScheduler } from '$lib/health/scheduler';
import { startScheduler as startWorkflowScheduler } from '$lib/workflows/scheduler';
import { orchestrator } from '$lib/jkai/orchestrator';
import { startOrphanSweep } from '$lib/jkai/media/sweep';
import { isPublicPath } from '$lib/auth';
import { rateLimit } from '$lib/server/rate-limit';
import { SvelteKitAuth } from '@auth/sveltekit';
import Google from '@auth/sveltekit/providers/google';
import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { env } from '$env/dynamic/private';

// Expensive endpoints — apply per-user rate limits.
// Pattern → { capacity (burst), refillPerSecond (steady-state) }.
const RATE_LIMITS: Array<{ pattern: RegExp; capacity: number; refillPerSecond: number }> = [
  { pattern: /^\/api\/deepdive(\/|$)/, capacity: 5, refillPerSecond: 5 / 60 }, // 5/min
  { pattern: /^\/api\/quickanswer(\/|$)/, capacity: 10, refillPerSecond: 10 / 60 }, // 10/min
  { pattern: /^\/api\/cdo-plan(\/|$)/, capacity: 5, refillPerSecond: 5 / 60 },
  { pattern: /^\/api\/workflows\/orchestrator(\/|$)/, capacity: 10, refillPerSecond: 10 / 60 },
  { pattern: /^\/api\/workflows\/webhook(\/|$)/, capacity: 20, refillPerSecond: 20 / 60 },
  { pattern: /^\/api\/jkai\/builds(\/|$)/, capacity: 5, refillPerSecond: 5 / 60 },
  { pattern: /^\/api\/jkai\/(conversations|chat)(\/|$)/, capacity: 30, refillPerSecond: 30 / 60 },
];

// Start the health data sync scheduler
startScheduler();

// Start the workflow cron scheduler
startWorkflowScheduler().catch((err) => {
  console.error('[hooks.server] Workflow scheduler failed to start:', err);
});

// Start the JKAI orphan attachment sweep (runs immediately + hourly)
startOrphanSweep();

// Start the Gmail polling watcher and orchestrator bridge
import { startWatcher as startGmailWatcher, stopWatcher as stopGmailWatcher } from '$lib/workflows/gmail/watcher';
import { registerGmailBridge, unregisterGmailBridge } from '$lib/workflows/gmail/orchestrator-bridge';
startGmailWatcher();
registerGmailBridge();

// Graceful shutdown — stop schedulers so process can exit on SIGTERM
import { stopScheduler as stopHealthScheduler } from '$lib/health/scheduler';
import { stopScheduler as stopWorkflowScheduler } from '$lib/workflows/scheduler';

function gracefulShutdown() {
  console.log('[hooks.server] Shutting down...');
  stopHealthScheduler();
  stopWorkflowScheduler();
  stopGmailWatcher();
  unregisterGmailBridge();
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

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
      if (allowed.length === 0) return false;
      const email = (user?.email || (profile as any)?.email || '').toLowerCase();
      console.log(`[auth] Sign-in attempt: ${email}`);
      return allowed.some((a) => a.toLowerCase() === email);
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

  // Dev-only bypass for local-network admin access. The dev server runs on
  // homeserv and is reachable only on the LAN; Google's OAuth rules refuse
  // private-network redirect URIs so standard sign-in isn't available. Gate
  // strictly on dev build AND a private RFC1918/loopback client.
  if (import.meta.env.DEV) {
    let clientAddr = '';
    try { clientAddr = event.getClientAddress?.() ?? ''; } catch { clientAddr = ''; }
    const isPrivate =
      clientAddr === '127.0.0.1' ||
      clientAddr === '::1' ||
      clientAddr.startsWith('10.') ||
      clientAddr.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(clientAddr);
    if (isPrivate) {
      return resolve(event);
    }
  }

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

    // Rate-limit expensive endpoints per authenticated user.
    const limit = RATE_LIMITS.find((r) => r.pattern.test(pathname));
    if (limit && event.request.method !== 'GET') {
      const userKey = (session.user as any).email || (session.user as any).id || 'anon';
      const result = rateLimit(`${userKey}:${pathname}`, {
        capacity: limit.capacity,
        refillPerSecond: limit.refillPerSecond,
      });
      if (!result.allowed) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded', retryAfterMs: result.retryAfterMs }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(Math.ceil(result.retryAfterMs / 1000)),
            },
          },
        );
      }
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
