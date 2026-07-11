import { startScheduler } from '$lib/health/scheduler';
import { startScheduler as startWorkflowScheduler } from '$lib/workflows/scheduler';
import { startForgeScheduler, stopForgeScheduler } from '$lib/jkai/forge-scheduler';
import {
  startHeroTitlesScheduler,
  stopHeroTitlesScheduler,
} from '$lib/landing/hero-titles-scheduler';
// JKAI build orchestrator no longer boots in the SvelteKit web app — it runs
// in the jkai-builder sidecar service (packages/jkai-builder/, system unit
// jkai-builder.service). Build-control routes call it over the Unix socket
// via $lib/jkai/builder-client. Phase 3 of docs/plans/jkai-build-rewrite.md.
import { startOrphanSweep } from '$lib/jkai/media/sweep';
// Side-effect import: every integration adapter registers itself on load.
// The barrel is maintained by the node-builder codegen.
import '$lib/integrations/adapters';
import { isPublicPath, isGuestAllowedPath } from '$lib/auth';
import { resolveAdminRedirect } from '$lib/components/admin/admin-nav';
import { isEmailAllowedToSignIn, isOwnerEmail } from '$lib/server/access';
import { rateLimit } from '$lib/server/rate-limit';
import { hasMaintenanceSecret } from '$lib/server/maintenance-auth';
import { SvelteKitAuth } from '@auth/sveltekit';
import Google from '@auth/sveltekit/providers/google';
import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { env } from '$env/dynamic/private';

// Expensive endpoints — apply per-user rate limits.
// Pattern → { capacity (burst), refillPerSecond (steady-state) }.
const RATE_LIMITS: Array<{ pattern: RegExp; capacity: number; refillPerSecond: number }> = [
  // Synthesis is a per-toggle streamed LLM pass — costlier than a deep run kickoff
  // and user-triggerable in bursts. Must precede the broad /api/deepdive rule
  // because RATE_LIMITS.find() returns the FIRST matching pattern.
  { pattern: /^\/api\/deepdive\/[^/]+\/synthesize$/, capacity: 3, refillPerSecond: 3 / 60 }, // 3/min
  // /api/deepdive/source-image is GET-only and not listed here — the rate-limiter
  // below only fires on non-GET requests, so a GET entry would be dead code.
  // Cost is bounded by: auth gate + 1h in-process cache + 5s fetch timeout + SSRF guard.
  { pattern: /^\/api\/deepdive(\/|$)/, capacity: 5, refillPerSecond: 5 / 60 }, // 5/min
  { pattern: /^\/api\/quickanswer(\/|$)/, capacity: 10, refillPerSecond: 10 / 60 }, // 10/min
  { pattern: /^\/api\/workflows\/orchestrator(\/|$)/, capacity: 10, refillPerSecond: 10 / 60 },
  { pattern: /^\/api\/workflows\/webhook(\/|$)/, capacity: 20, refillPerSecond: 20 / 60 },
  { pattern: /^\/api\/jkai\/builds(\/|$)/, capacity: 5, refillPerSecond: 5 / 60 },
  { pattern: /^\/api\/jkai\/(conversations|chat)(\/|$)/, capacity: 30, refillPerSecond: 30 / 60 },
  { pattern: /^\/api\/projects\/share(\/|$)/, capacity: 30, refillPerSecond: 30 / 60 }, // share-link create/revoke
];

// Start the health data sync scheduler
startScheduler();

// Start the workflow cron scheduler
startWorkflowScheduler().catch((err) => {
  console.error('[hooks.server] Workflow scheduler failed to start:', err);
});

// Start the Forge trigger scheduler (scheduled + autonomous brass-and-rails
// builds). Leader-elected on its own advisory-lock lane.
startForgeScheduler().catch((err) => {
  console.error('[hooks.server] Forge scheduler failed to start:', err);
});

// Start the landing-page hero-title regeneration scheduler
startHeroTitlesScheduler();

// Start the JKAI orphan attachment sweep (runs immediately + hourly)
startOrphanSweep();

// Install the WhatsApp escalation hook so orchestrator waiters / terminal
// events fan out to WA when the user isn't attached to the chat stream.
import { installWaEscalation } from '$lib/workflows/chat/wa-escalation';
installWaEscalation();

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
import { engine as workflowEngine } from '$lib/workflows';

let shuttingDown = false;
async function gracefulShutdown() {
  // SIGTERM can fire more than once during a deploy; only drain/stop once.
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[hooks.server] Shutting down...');
  // #10 GRACEFUL DRAIN: let in-flight workflow runs finish (bounded) BEFORE we
  // tear down schedulers and exit, so a deploy mid-run doesn't orphan it.
  // Bounded at 25s so shutdown can never hang past the supervisor's kill grace.
  try {
    await workflowEngine.drain(25_000);
  } catch (err) {
    console.warn('[hooks.server] engine drain failed:', err);
  }
  stopHeartbeatEngine();
  stopScheduledEngine();
  stopHealthScheduler();
  stopWorkflowScheduler();
  stopForgeScheduler();
  stopHeroTitlesScheduler();
  stopGmailWatcher();
  unregisterGmailBridge();
  process.exit(0);
}

process.on('SIGTERM', () => void gracefulShutdown());
process.on('SIGINT', () => void gracefulShutdown());

// Build recovery moved to packages/jkai-builder/bin/start.ts.
// hooks.server.ts intentionally does NOT call orchestrator.recoverOnStartup()
// any more — the SvelteKit web app is no longer the build state owner.

// Subscribe build orchestrator to workflow_completed events for push-back delivery
import { registerDeliveryListener } from '$lib/jkai/workflow-deliveries';
registerDeliveryListener();

// Sign-in gating (owners env + guest allow-list) lives in $lib/server/access.

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
      const email = (user?.email || (profile as any)?.email || '').toLowerCase();
      // Owners (AUTH_ALLOWED_EMAILS) OR guests (allowed_user table) may sign in.
      const ok = await isEmailAllowedToSignIn(email);
      console.log(`[auth] Sign-in attempt: ${email} → ${ok ? 'allowed' : 'denied'}`);
      return ok;
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

  // Admin consolidation (2026-07): the /admin route tree was reorganised into
  // six sections. 308-redirect the old flat URLs to their new homes (preserving
  // any sub-path + query so ?token= and /blog/[id] survive). Only page routes
  // are in the map — /api/admin/* endpoints did not move and never match here.
  {
    const target = resolveAdminRedirect(pathname);
    if (target) {
      const search = event.url.search; // '' or '?...'
      const suffix = target.includes('?')
        ? search
          ? '&' + search.slice(1)
          : ''
        : search;
      throw redirect(308, target + suffix);
    }
  }

  // Local-network bypass for admin access on homeserv. The dev server (and
  // the homeserv systemd prod build when AUTH_BYPASS=1) are reachable only
  // on the LAN; Google's OAuth rules refuse private-network redirect URIs
  // and prod-build cookies are scoped to .strangeramblings.com so standard
  // sign-in isn't viable from those hosts. Double gate: either it's a dev
  // build OR the AUTH_BYPASS=1 env var is set, AND the client is on a
  // private RFC1918 / loopback address. Public clients on prod still go
  // through Google even if AUTH_BYPASS leaks to that env.
  if (import.meta.env.DEV || env.AUTH_BYPASS === '1') {
    let clientAddr = '';
    try { clientAddr = event.getClientAddress?.() ?? ''; } catch { clientAddr = ''; }
    const isPrivate =
      clientAddr === '127.0.0.1' ||
      clientAddr === '::1' ||
      clientAddr.startsWith('10.') ||
      clientAddr.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(clientAddr) ||
      // Tailscale CGNAT range (100.64.0.0/10) — covers homeserv's Tailscale clients.
      /^100\.(6[4-9]|[789]\d|1[01]\d|12[0-7])\./.test(clientAddr);
    if (isPrivate) {
      return resolve(event);
    }
  }

  if (isPublicPath(pathname)) {
    return resolve(event);
  }

  // WebDAV mount endpoint. Auth is HTTP Basic against webdav_credentials,
  // not Google OAuth — Finder/Explorer/davfs can't do federated auth. The
  // credential row is recorded in event.locals.davAuth and verb handlers
  // attribute writes to its ownerEmail.
  if (pathname === '/dav' || pathname.startsWith('/dav/')) {
    const { parseBasicAuth, verifySecret } = await import('$lib/webdav/auth');
    const creds = parseBasicAuth(event.request.headers.get('authorization'));
    const ctx = creds ? await verifySecret(creds.pass) : null;
    if (!ctx) {
      return new Response('Unauthorized', {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Basic realm="strangeramblings.com webdav"',
          'content-type': 'text/plain',
        },
      });
    }
    event.locals.davAuth = ctx;
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

  // Public API routes — read-only, used by public pages (plus the write-only
  // heartbeat-renderer telemetry beacon, which stores nothing).
  const PUBLIC_API_PATHS = [
    '/api/biome/state',
    '/api/family-presence/stats',
    '/api/landing/ecg-telemetry',
  ];
  if (PUBLIC_API_PATHS.some((p) => pathname === p)) {
    return resolve(event);
  }

  // /api/mcp* are service-to-service: the routing proxy and the local
  // dispatcher both authenticate via `Authorization: Bearer
  // HERMES_BRIDGE_SECRET` inside the handlers themselves. They must
  // bypass the Auth.js gate so the VPS-originated tool calls from
  // homeserv's Hermes can land here on the VPS.
  if (pathname === '/api/mcp' || pathname.startsWith('/api/mcp/')) {
    return resolve(event);
  }

  // /api/policy-engine/* (ingest + seed-workflows) are service-to-service: the
  // scheduled tracking workflows' http-request node has no user session. The
  // handlers self-authenticate via `Authorization: Bearer POLICY_INGEST_SECRET`,
  // so they must bypass the Auth.js gate (mirrors /api/mcp above). GET is the
  // read-only tracked-indicator list, already public via the /monitor page.
  if (pathname.startsWith('/api/policy-engine/')) {
    return resolve(event);
  }

  // /api/claude-changelog/ingest POST is service-to-service: the homeserv cron
  // scanner (scripts/claude-changelog/ingest.mjs) POSTs parsed transcripts and has
  // no user session. It self-authenticates via `Authorization: Bearer
  // CLAUDE_CHANGELOG_SECRET`, so the POST bypasses the Auth.js gate (mirrors
  // /api/policy-engine above). GET (debug summary) is deliberately NOT bypassed —
  // it falls through to the owner gate below (spec Decision Log #6: reads stay
  // owner-only).
  if (pathname.startsWith('/api/claude-changelog/') && event.request.method === 'POST') {
    return resolve(event);
  }

  // /api/data-standard-designer/* (ingest + seed-workflows) are service-to-service:
  // the daily discovery cron's http-request node has no user session. The handlers
  // self-authenticate via `Authorization: Bearer DSD_INGEST_SECRET` (open in dev if
  // unset). GET on ingest is the read-only registry snapshot used by the portal.
  if (pathname.startsWith('/api/data-standard-designer/')) {
    return resolve(event);
  }

  // /api/dfe-data-strategy/* (intel sweep + seed-workflows) are service-to-service:
  // the daily intelligence cron's http-request node has no user session. The handlers
  // self-authenticate via `Authorization: Bearer KEYSTONE_INTEL_SECRET` (open in dev if
  // unset). GET on intel is the read-only radar snapshot.
  if (pathname.startsWith('/api/dfe-data-strategy/')) {
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

  // Maintenance endpoints (research re-index / source backfill) are driven by a
  // one-off run from the box (VPS loopback) carrying a shared secret, with no
  // user session — so they can't pass the owner-gate below. Let a valid
  // secret + loopback through here; the endpoint re-checks the secret
  // (defence-in-depth). An owner browser (no secret) falls through to the normal
  // owner-gate and still works.
  if (pathname === '/api/deepdive/index-sources' || pathname === '/api/deepdive/reindex-facts') {
    let clientAddr = '';
    try { clientAddr = event.getClientAddress?.() ?? ''; } catch { clientAddr = ''; }
    const isLoopback = clientAddr === '127.0.0.1' || clientAddr === '::1';
    if (isLoopback && hasMaintenanceSecret(event.request)) {
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

    // Authed APIs are owner-only by default. A guest on the login allow-list has
    // a valid session but may only reach the guest-allowed surface (none, by
    // default). The genuinely public / service-to-service APIs (biome, agent,
    // jkai proxy, space-lander, scraper, mcp, policy-engine, admin/hermes, …)
    // already returned earlier via isPublicPath and the explicit bypasses above,
    // so they never reach here. This subsumes the old /api/admin/* gate. Before
    // guests existed a session implied owner; introducing guests broke that
    // equivalence for every authed API, so gate them all here. (The homeserv LAN
    // bypass returns earlier still, so local access on the box is unaffected.)
    if (!isOwnerEmail(session.user.email) && !isGuestAllowedPath(pathname)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
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
  const PUBLIC_PATHS = ['/health', '/tools'];
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return resolve(event);
  }

  // Page routes redirect to sign-in
  const session = await event.locals.auth();
  if (!session?.user) {
    const callbackUrl = encodeURIComponent(pathname + event.url.search);
    throw redirect(302, `/login?callbackUrl=${callbackUrl}`);
  }

  // Authed pages are owner-only by default. A guest on the login allow-list can
  // sign in but only reach public pages plus any guest-allowed prefix
  // (isGuestAllowedPath — empty by default). /jkai, /admin, /live, /deepdive, the
  // canvas, etc. are all owner-only. The homeserv LAN bypass above returns
  // earlier, so local access on the box is unaffected.
  if (!isOwnerEmail(session.user.email) && !isGuestAllowedPath(pathname)) {
    throw redirect(303, '/');
  }

  return resolve(event);
};

const securityHeadersHandle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  // Framing policy: pages default to SAMEORIGIN (cross-origin embedding stays
  // blocked) because sr. decks legitimately frames site pages as slides — the
  // deck iframe block and the editor's site-media browser both need it. The
  // sensitive surfaces (admin, auth, APIs) keep hard DENY, except the two
  // long-standing same-origin API carve-outs: the jkai build proxy and /drive
  // file downloads (PDF viewer).
  const framePath = event.url.pathname;
  if (
    framePath.startsWith('/api/jkai/proxy/') ||
    (framePath.startsWith('/api/files/') && framePath.endsWith('/download'))
  ) {
    response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  } else if (framePath.startsWith('/admin') || framePath.startsWith('/api') || framePath.startsWith('/login')) {
    response.headers.set('X-Frame-Options', 'DENY');
  } else {
    response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  }
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Defence-in-depth for share links: any /projects/* response opened with a
  // share token (?t=) must never be edge-cached, indexed, or leak the token
  // onward via Referer — even if a route handler forgets. (Per-route guards
  // already set no-store/noindex for shared/private views; this is the backstop,
  // and no-referrer additionally stops the live token in the URL reaching any
  // same-origin sub-resource via the Referer header.)
  if (event.url.pathname.startsWith('/projects/') && event.url.searchParams.has('t')) {
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-Robots-Tag', 'noindex');
    response.headers.set('Referrer-Policy', 'no-referrer');
  }
  response.headers.set(
    'Permissions-Policy',
    'geolocation=(self), microphone=(), camera=(), payment=(), usb=()',
  );
  // HSTS only for hosts that actually serve HTTPS. The homeserv systemd build
  // is a prod build but serves plain HTTP on the LAN / Tailscale, and a stray
  // HSTS header there poisons the browser cache for the hostname — every
  // subsequent http://homeserv... request gets force-upgraded to https://...
  // which has no listener, so the page silently breaks (no JS, no API calls).
  if (import.meta.env.PROD && event.url.hostname.endsWith('strangeramblings.com')) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  }
  return response;
};

export const handle = sequence(authHandle, protectionHandle, securityHeadersHandle);
