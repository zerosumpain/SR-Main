import { startScheduler } from '$lib/health/scheduler';
import { startScheduler as startWorkflowScheduler } from '$lib/workflows/scheduler';
// JKAI build orchestrator no longer boots in the SvelteKit web app — it runs
// in the jkai-builder sidecar service (packages/jkai-builder/, system unit
// jkai-builder.service). Build-control routes call it over the Unix socket
// via $lib/jkai/builder-client. Phase 3 of docs/plans/jkai-build-rewrite.md.
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

// Start the heartbeat engine — periodic autonomous activities (chat
// continuation, build/job nudges, workflow review). Tickers are configured
// in the heartbeat_activities table; the engine ticks every 30s and fires
// any activity whose next_tick_at has passed.
import { startHeartbeatEngine, stopHeartbeatEngine } from '$lib/heartbeat/engine';
startHeartbeatEngine().catch((err) => {
  console.error('[hooks.server] Heartbeat engine failed to start:', err);
});

// Scheduled-callbacks engine — the OpenClaw "cron lane". One-shot
// time-based fires. Distinct from heartbeat (periodic agent turns) and
// background tasks (long-running watched work).
import { startScheduledEngine, stopScheduledEngine } from '$lib/scheduled/engine';
startScheduledEngine().catch((err) => {
  console.error('[hooks.server] Scheduled engine failed to start:', err);
});

// Graceful shutdown — stop schedulers so process can exit on SIGTERM
import { stopScheduler as stopHealthScheduler } from '$lib/health/scheduler';
import { stopScheduler as stopWorkflowScheduler } from '$lib/workflows/scheduler';

function gracefulShutdown() {
  console.log('[hooks.server] Shutting down...');
  stopHeartbeatEngine();
  stopScheduledEngine();
  stopHealthScheduler();
  stopWorkflowScheduler();
  stopGmailWatcher();
  unregisterGmailBridge();
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Build recovery moved to packages/jkai-builder/bin/start.ts.
// hooks.server.ts intentionally does NOT call orchestrator.recoverOnStartup()
// any more — the SvelteKit web app is no longer the build state owner.

// Subscribe build orchestrator to workflow_completed events for push-back delivery
import { registerDeliveryListener } from '$lib/jkai/workflow-deliveries';
registerDeliveryListener();

// Allowed email addresses
function getAllowedEmails(): string[] {
  const emails = env.AUTH_ALLOWED_EMAILS || '';
  return emails.split(',').map((e) => e.trim()).filter(Boolean);
}

// Cookie domain: in production, share across all *.strangeramblings.com
// subdomains (main site + vnc.strangeramblings.com) so the VNC proxy can
// validate the session via forward_auth. In dev we leave domain unset
// (host-scoped cookie for localhost / homeserv).
const COOKIE_DOMAIN = import.meta.env.PROD ? '.strangeramblings.com' : undefined;

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
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: import.meta.env.PROD,
        domain: COOKIE_DOMAIN,
      },
    },
    callbackUrl: {
      options: {
        sameSite: 'lax',
        path: '/',
        secure: import.meta.env.PROD,
        domain: COOKIE_DOMAIN,
      },
    },
    csrfToken: {
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: import.meta.env.PROD,
        // csrfToken must NOT carry a domain attribute — must stay host-locked.
      },
    },
  },
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

  // /api/scraper/script is service-to-service when called on homeserv (the
  // host that owns the scrape scripts) and user-authenticated when called on
  // the VPS (the panel proxies through). Whitelist on homeserv only — its
  // POST handler still enforces SCRAPER_SERVICE_TOKEN.
  if (pathname.startsWith('/api/scraper/script')) {
    const { hostname } = await import('os');
    if (hostname() === 'homeserv' || process.env.SCRAPER_ALLOW_NON_HOMESERV) {
      return resolve(event);
    }
  }

  // Public API routes — read-only, used by public pages.
  const PUBLIC_API_PATHS = ['/api/biome/state'];
  if (PUBLIC_API_PATHS.some((p) => pathname === p)) {
    return resolve(event);
  }

  // /api/health/workflow-engine is consumed by the systemd watchdog timer
  // (curl from 127.0.0.1) — no user session, no service token. Restrict to
  // loopback to prevent it being scraped externally for run counts.
  if (pathname === '/api/health/workflow-engine') {
    let clientAddr = '';
    try { clientAddr = event.getClientAddress?.() ?? ''; } catch { clientAddr = ''; }
    if (clientAddr === '127.0.0.1' || clientAddr === '::1') {
      return resolve(event);
    }
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

  // Public page routes — no auth required.
  const PUBLIC_PATHS = ['/health'];
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
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

const securityHeadersHandle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'geolocation=(self), microphone=(), camera=(), payment=(), usb=()',
  );
  if (import.meta.env.PROD) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  }
  return response;
};

export const handle = sequence(authHandle, protectionHandle, securityHeadersHandle);
