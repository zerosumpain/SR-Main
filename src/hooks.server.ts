import { building } from '$app/environment';
import { startScheduler } from '$lib/health-sync/scheduler';
import { startForgeScheduler, stopForgeScheduler } from '$lib/jkai/forge-scheduler';
import {
  startHeroTitlesScheduler,
  stopHeroTitlesScheduler,
} from '$lib/landing/hero-titles-scheduler';
import {
  startDependencyMonitor,
  stopDependencyMonitor,
} from '$lib/dependencies/monitor.server';
import { startHealthWatch, stopHealthWatch } from '$lib/server/notify/health-watch';
import { startConnectorWatch, stopConnectorWatch } from '$lib/connectors/watch';
// JKAI build orchestrator no longer boots in the SvelteKit web app — it runs
// in the jkai-builder sidecar service (packages/jkai-builder/, system unit
// jkai-builder.service). Build-control routes call it over the Unix socket
// via $lib/jkai/builder-client. Phase 3 of docs/plans/jkai-build-rewrite.md.
import { startOrphanSweep } from '$lib/jkai/media/sweep';
// Side-effect import: every integration adapter registers itself on load.
// The barrel is maintained by the node-builder codegen.
import '$lib/integrations/adapters';
import { isPublicPath, isGuestAllowedPath, isMemberAllowedRoute } from '$lib/auth';
import { requestHost } from '$lib/request-host';
import { resolveAdminRedirect } from '$lib/components/admin/admin-nav';
import { isEmailAllowedToSignIn, isOwnerEmail } from '$lib/server/access';
import { viewerOf } from '$lib/server/viewer';
import { rateLimit } from '$lib/server/rate-limit';
import { nativeDevice } from '$lib/server/native-gate';
import { hasMaintenanceSecret } from '$lib/server/maintenance-auth';
import { isPublicApiPath } from '$lib/server/public-api-paths';
import { hasStudioServiceToken } from '$lib/server/studio-auth';
import { invokeLaneFor, hasJkaiServiceToken } from '$lib/server/invoke-auth';
import { isLoopbackAddress, isPrivateAddress } from '$lib/server/client-address';
import { SvelteKitAuth } from '@auth/sveltekit';
import Google from '@auth/sveltekit/providers/google';
import { isRedirect, redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { env } from '$env/dynamic/private';
import { runsService } from '$lib/workflows/service-role';

/**
 * The rate-limit decision, shared by the owner gate and the native device lanes.
 *
 * Lifted out of the owner gate when the iPhone lane was added: that lane returns
 * before the gate, so a copy of this logic there would have been a second place
 * for the ceilings to drift from the table they are supposed to enforce.
 *
 * Returns a 429 Response when the caller is over, or null to proceed.
 */
function rateLimited(pathname: string, method: string, callerKey: string): Response | null {
  const limit = RATE_LIMITS.find((r) => r.pattern.test(pathname));
  if (!limit || method === 'GET') return null;
  const result = rateLimit(`${callerKey}:${pathname}`, {
    capacity: limit.capacity,
    refillPerSecond: limit.refillPerSecond,
  });
  if (result.allowed) return null;
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
  // Studio and Forge each kick off an autonomous multi-hour build (STUDIO_BUDGET:
  // up to $15 and 480 minutes). Unlike /builds these were unmatched entirely, so
  // a retry loop could queue them serially. 3/hour, not 3/minute.
  { pattern: /^\/api\/jkai\/(studio|forge)(\/|$)/, capacity: 3, refillPerSecond: 3 / 3600 }, // 3/hour
  { pattern: /^\/api\/jkai\/(conversations|chat)(\/|$)/, capacity: 30, refillPerSecond: 30 / 60 },
  // Each run is a docker exec with a 20s ceiling. 20/min is far more than a
  // human clicking Run in the runner window, and caps what a stuck retry loop
  // in that window could hold open at once.
  { pattern: /^\/api\/jkai\/run-snippet(\/|$)/, capacity: 20, refillPerSecond: 20 / 60 },
  { pattern: /^\/api\/projects\/share(\/|$)/, capacity: 30, refillPerSecond: 30 / 60 }, // share-link create/revoke
  // The phone's writes. Matched nothing until now: the per-device key was being
  // computed and handed to a table with no pattern for it, so `rateLimited`
  // returned null and the lane was uncapped. The limiter only fires on non-GET,
  // so this covers acknowledging notifications, changing a routing switch,
  // starting a thread and renaming or deleting one — not the reads.
  //
  // 60/min is far above anything a thumb produces (a background refresh sends
  // ONE acknowledgement for a whole batch) and low enough to stop a retry loop
  // in a background task from running all night.
  { pattern: /^\/api\/native(\/|$)/, capacity: 60, refillPerSecond: 60 / 60 },
];

// Start the health data sync scheduler
if (runsService('scheduler')) startScheduler();

// The workflow cron scheduler boots in $lib/workflows/index.ts, inside the
// runsService('scheduler') gate, alongside every other platform service. It used
// to be started here as well, ungated — this call predated service roles, so a
// process running these hooks under JKAI_SERVICE_ROLE=whatsapp would have started
// a second scheduler, which is the exact "every cron fires twice" failure
// service-role.ts exists to prevent. Both sites in fact registered every schedule
// at boot, harmlessly (registerCronJob replaces by id), and it stayed invisible
// only because the gated one threw on a temporal-dead-zone error until 2026-09-04.
// Do not re-add a boot call here. stopScheduler() is still wired to shutdown below.

// Start the Forge trigger scheduler (scheduled + autonomous brass-and-rails
// builds). Leader-elected on its own advisory-lock lane.
if (runsService('scheduler')) startForgeScheduler().catch((err) => {
  console.error('[hooks.server] Forge scheduler failed to start:', err);
});

// Start the landing-page hero-title regeneration scheduler
if (runsService('scheduler')) startHeroTitlesScheduler();

// Record the public journey and upstream provider state every five minutes,
// including while nobody has /admin open.
if (runsService('scheduler')) startDependencyMonitor();

// Watch the health figures and raise a notification when they move. The check
// is cheap (a fingerprint comparison) and frequent; the three-hour floor John
// asked for lives on the `health` notification category, enforced against the
// ledger inside notifyOwner — so this interval is free to be much shorter than
// the rate at which anybody is told anything.
if (runsService('scheduler')) startHealthWatch();

// Watch every connector and tell the owner (phone + WhatsApp, category
// `connections`) when one needs re-authorising or is down, with a 12-hour
// reminder while it stays that way. Replaced the 06:45 daily check, which let
// a Gmail token that died at 07:40 go unnoticed for 23 hours.
if (runsService('scheduler')) startConnectorWatch();

// Start the JKAI orphan attachment sweep (runs immediately + hourly)
if (runsService('background')) startOrphanSweep();

// Install the WhatsApp escalation hook so orchestrator waiters / terminal
// events fan out to WA when the user isn't attached to the chat stream.
import { installWaEscalation } from '$lib/workflows/chat/wa-escalation';
if (runsService('background')) installWaEscalation();

// Start the Gmail polling watcher and orchestrator bridge
import { startWatcher as startGmailWatcher, stopWatcher as stopGmailWatcher } from '$lib/workflows/gmail/watcher';
import { registerGmailBridge, unregisterGmailBridge } from '$lib/workflows/gmail/orchestrator-bridge';
if (runsService('background')) startGmailWatcher();
if (runsService('background')) registerGmailBridge();

// Start the heartbeat engine — periodic autonomous activities (chat
// continuation, build/job nudges, workflow review). Tickers are configured
// in the heartbeat_activities table; the engine ticks every 30s and fires
// any activity whose next_tick_at has passed.
import { startHeartbeatEngine, stopHeartbeatEngine } from '$lib/heartbeat/engine';
if (runsService('background')) startHeartbeatEngine().catch((err) => {
  console.error('[hooks.server] Heartbeat engine failed to start:', err);
});

// Scheduled-callbacks engine — the OpenClaw "cron lane". One-shot
// time-based fires. Distinct from heartbeat (periodic agent turns) and
// background tasks (long-running watched work).
import { startScheduledEngine, stopScheduledEngine } from '$lib/scheduled/engine';
if (runsService('background')) startScheduledEngine().catch((err) => {
  console.error('[hooks.server] Scheduled engine failed to start:', err);
});

// Datastore TTL reaper + self-improvement seeds. The reaper sweeps expired
// records hourly; self-improvement seeds its system collections and API
// catalogue on every boot. Its nightly RUN is no longer scheduled here — that
// moved onto the heartbeat as the `daydream-improve` activity, so the site has
// one idle-cycle scheduler instead of two. Neither belongs in the jkai-builder
// sidecar process.
import { startDatastoreReaper, stopDatastoreReaper } from '$lib/datastore';
import { startDriveIntelOutbox, stopDriveIntelOutbox } from '$lib/jkai/intel/drive-outbox';
import { startSelfImprovementSeeds } from '$lib/selfimprove/engine';
import { startVoiceDrift } from '$lib/voice/drift-engine';
// Nightly workflow doctor — triages node_executions failures, quarantines
// runaway schedules, proposes fixes. Structural sibling of selfimprove: same
// prod-only cron gate, same leader-elected lane, so it boots the same way.
// Both engines now run on the heartbeat: this import only seeds the doctor's
// two datastore collections at boot, and `daydream-doctor` is the schedule.
import { startWorkflowDoctor, stopWorkflowDoctor } from '$lib/workflowdoctor/engine';
import { startBriefingEngine, stopBriefingEngine } from '$lib/briefing/engine';
import { startModelRouting, stopModelRouting } from '$lib/routing/engine';
// Nightly intel maintenance: confidence scores, watchlist diffs, live-query
// lenses. Each of those had a batch half nothing was calling — a watchlist that
// only diffs when you open its endpoint is not a watchlist.
import { startIntelEngine, stopIntelEngine } from '$lib/jkai/intel/engine';
// Research runs whose worker was lost. Worker state is process-local and
// `startResearch` is fire-and-forget, so a deploy landing mid-run used to strand
// the session permanently — seven of thirty-one production sessions were stuck
// in a non-terminal status before this existed, the oldest for four months. CI
// deploys on every merge, so the exposure is continuous.
import { runResumeSweep, RESUME_SWEEP_INTERVAL_MS } from '$lib/deepdive/resume';
import { startRunWorker, stopRunWorker } from '$lib/workflows/run-worker';
import { webWorkerOptions } from '$lib/workflows/policy-worker-mode';
if (!building) {
  const options = webWorkerOptions(runsService('background'));
  if (options) startRunWorker();
}
if (runsService('background')) {
  startDatastoreReaper();
  // Drains what Drive hands Intelligence. A no-op until Drive is its own
  // application — while both live here, Drive still calls these functions
  // directly and the table stays empty.
  startDriveIntelOutbox();
  startSelfImprovementSeeds();
  // Monthly, advisory only — it writes a note and never touches the card.
  startVoiceDrift();
  startWorkflowDoctor();
  startBriefingEngine();
  startModelRouting();
  startIntelEngine();
  /**
   * Deliberately delayed, then repeated.
   *
   * The delay is because a redeploy restarts this process while the OLD one may
   * still be finishing its graceful drain, and adopting a session its previous
   * owner is still working on would run it twice.
   *
   * The repeat is because one sweep at boot could not do the job it was written
   * for. It fires 30 seconds in, and only adopts a run whose heartbeat is older
   * than STALE_AFTER_MS (90 seconds) — so a run that was beating right up to the
   * restart is ALWAYS too fresh to be seen, and nothing ever looks again. It
   * survived to the next deploy, which lost the same race. Measured on
   * production 2026-08-15: the service restarted at 06:33:30 with a heartbeat
   * from 06:33:24, the sweep ran at 06:34:00 and skipped it, and the run sat
   * unowned in phase2 with 848 facts and nobody working on it.
   *
   * Now the sweep is a heartbeat of its own. A dead worker is picked up within a
   * couple of minutes rather than at the whim of when the next merge lands.
   */
  const sweep = () =>
    runResumeSweep().catch((err) => console.error('[hooks.server] research resume sweep:', err));
  setTimeout(() => {
    void sweep();
    setInterval(sweep, RESUME_SWEEP_INTERVAL_MS).unref?.();
  }, 30_000).unref?.();
}

// Graceful shutdown — stop schedulers so process can exit on SIGTERM
import { stopScheduler as stopHealthScheduler } from '$lib/health-sync/scheduler';
import { stopScheduler as stopWorkflowScheduler } from '$lib/workflows/scheduler';
import { engine as workflowEngine } from '$lib/workflows';

let shuttingDown = false;
async function gracefulShutdown() {
  // SIGTERM can fire more than once during a deploy; only drain/stop once.
  if (shuttingDown) return;
  shuttingDown = true;
  // Stop claiming new policy stages; the existing shutdown deadline bounds drain.
  void stopRunWorker();
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
  stopDependencyMonitor();
  stopHealthWatch();
  stopGmailWatcher();
  unregisterGmailBridge();
  stopDatastoreReaper();
    stopDriveIntelOutbox();
  stopWorkflowDoctor();
  stopBriefingEngine();
  stopConnectorWatch();
  stopModelRouting();
  stopIntelEngine();
  process.exit(0);
}

process.on('SIGTERM', () => void gracefulShutdown());
process.on('SIGINT', () => void gracefulShutdown());

// Build recovery moved to packages/jkai-builder/bin/start.ts.
// hooks.server.ts intentionally does NOT call orchestrator.recoverOnStartup()
// any more — the SvelteKit web app is no longer the build state owner.

// Subscribe build orchestrator to workflow_completed events for push-back delivery
import { registerDeliveryListener } from '$lib/jkai/workflow-deliveries';
if (runsService('background')) registerDeliveryListener();

// Sign-in gating (owners env + guest allow-list) lives in $lib/server/access.

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
      },
    },
    callbackUrl: {
      options: {
        sameSite: 'lax',
        path: '/',
        secure: import.meta.env.PROD,
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

// JKAImaps (maps.strangeramblings.com) was retired in favour of the /health hub, which
// does the same job with a server behind it — routes and recordings live in
// Postgres instead of one phone's IndexedDB. The hostname now points at this
// app, so every request arriving under it is a stale bookmark: send it to the
// nearest equivalent rather than dumping everything on one landing page.
//
// This runs before the auth gate on purpose. /health/activities is owner-only, so a
// redirect emitted after the gate would send visitors to /login?callbackUrl=…
// instead of telling them where the thing went.
const RETIRED_MAPS_HOST = 'maps.strangeramblings.com';

function retiredMapsTarget(pathname: string): string {
  const path = pathname.replace(/\/+$/, '').toLowerCase();
  if (path === '/create' || path === '/discover') return '/health/plan';
  if (path === '/record' || path.endsWith('/record')) return '/health/record';
  if (path.startsWith('/route')) return '/health/routes';
  if (path.startsWith('/history')) return '/health/activities';
  return '/health/activities';
}

/**
 * /trails moved under /health (2026-08).
 *
 * The body and the ground it covers were two dashboards asking the same
 * question, so they became one hub. Old URLs are in the installed PWA, in saved
 * links and in the retired-maps redirect above, so they 308 rather than 404.
 *
 * `/trails/dashboard` has no successor of its own — the physiology it showed is
 * the signed-in view of /health itself.
 *
 * Kept as a pure function and mirrored by trails-redirect.test.ts, which cannot
 * import this module without pulling in Auth.js and the whole workflow engine.
 */
export function trailsRedirectTarget(pathname: string): string | null {
  if (pathname !== '/trails' && !pathname.startsWith('/trails/')) return null;
  const rest = pathname.slice('/trails'.length).replace(/^\//, '').replace(/\/+$/, '');
  if (!rest) return '/health/activities';
  const [head, ...tail] = rest.split('/');
  if (head === 'dashboard') return '/health';
  if (head === 'segments' || head === 'plan' || head === 'routes' || head === 'record') {
    return ['/health', head, ...tail].join('/');
  }
  // Anything else is an activity id.
  return ['/health/activities', head, ...tail].join('/');
}

// Route protection
const protectionHandle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;

  // Browser state-changing requests must be same-origin. Requests made by
  // service clients generally carry no Origin/Sec-Fetch-Site and authenticate
  // with their own bearer/HMAC secret.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)) {
    const origin = event.request.headers.get('origin');
    const fetchSite = event.request.headers.get('sec-fetch-site');
    if ((origin && origin !== event.url.origin) || fetchSite === 'cross-site') {
      return new Response(JSON.stringify({ error: 'Cross-origin request blocked' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (requestHost(event) === RETIRED_MAPS_HOST) {
    throw redirect(301, `https://strangeramblings.com${retiredMapsTarget(pathname)}`);
  }

  // JKAI's small ambient/configuration pages were folded into the two places
  // they conceptually belong: background intelligence lives in Daydreams,
  // while prompts live beside the agents they shape. Keep exact redirects for
  // old bookmarks and notification payloads, but only the destination pages
  // are presented as features. Existing query parameters are retained unless
  // they would override the destination tab.
  const retiredJkaiPage = new Map<string, string>([
    ['/jkai/briefing', '/jkai/daydreams/briefing'],
    ['/jkai/monitors', '/jkai/daydreams/watches'],
    ['/jkai/improvement', '/jkai/daydreams/improvement'],
    ['/jkai/doctor', '/jkai/daydreams/doctor'],
    ['/jkai/prompts', '/jkai/agents?tab=prompts'],
    ['/jkai/research', '/research'],
  ]).get(pathname);
  if (retiredJkaiPage) {
    const destination = new URL(retiredJkaiPage, event.url.origin);
    for (const [key, value] of event.url.searchParams) {
      if (key !== 'tab') destination.searchParams.append(key, value);
    }
    throw redirect(308, destination.pathname + destination.search);
  }

  // /trails folded into /health. Before the auth gate on purpose — /trails is no
  // longer a route at all, so falling through would 302 a stale bookmark to
  // /login with a callbackUrl that leads nowhere.
  {
    const target = trailsRedirectTarget(pathname);
    if (target) throw redirect(308, target + event.url.search);
  }

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

  // Development-only local-network bypass. Production builds never honour an
  // environment toggle: a reverse tunnel makes internet clients appear to be
  // loopback, so address classification cannot safely authorise production.
  if (import.meta.env.DEV) {
    let clientAddr = '';
    try { clientAddr = event.getClientAddress?.() ?? ''; } catch { clientAddr = ''; }
    // `isPrivateAddress` rather than a list of prefixes written out here. The
    // hand-written version compared against `'127.0.0.1'` and missed
    // `::ffff:127.0.0.1`, which is what a dual-stack listener actually reports
    // — so on `vite dev --host` the bypass never fired and every request from
    // the box itself 401'd. See $lib/server/client-address.
    if (isPrivateAddress(clientAddr)) {
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

  // Public API routes — read-only, used by public pages (plus the write-only
  // heartbeat-renderer telemetry beacon, which stores nothing). The list lives
  // in $lib/server/public-api-paths so the security panel can display exactly
  // what this gate enforces, rather than a second copy that drifts from it.
  if (isPublicApiPath(pathname)) {
    return resolve(event);
  }

  // /api/mcp* are service-to-service: the routing proxy and the local
  // dispatcher both authenticate via `Authorization: Bearer
  // SERVICE_BRIDGE_SECRET` inside the handlers themselves. They must
  // bypass the Auth.js gate so a tool call from an MCP client can land.
  if (pathname === '/api/mcp' || pathname.startsWith('/api/mcp/')) {
    return resolve(event);
  }

  // /api/jkai/tools/{manifest,invoke} are service-to-service: the autonomous
  // builder's pi extension fetches its tool manifest and invokes site tools
  // from inside the build sandbox, with no user session. Both handlers
  // self-authenticate via `Authorization: Bearer <JKAI_BRIDGE_TOKEN>` — an
  // HMAC over the build id, verified in `$lib/jkai/tool-bridge` — so they must
  // bypass the Auth.js gate (mirrors /api/mcp above).
  //
  // Without this the gate 401s the bridge before the handler ever runs, and
  // because `verifyBridgeToken` swallows its own errors the failure surfaces as
  // "invalid token" rather than "blocked". That is why every production build
  // ran with ZERO site tools while the same code worked on homeserv, where
  // AUTH_BYPASS=1 hid it (found 2026-08-08 debugging builds #125/#126).
  //
  // Named exactly, NOT by prefix: the sibling `/api/jkai/tools/promote` has no
  // auth of its own and must keep falling through to the owner gate, or
  // promoting an ephemeral tool into the permanent registry becomes anonymous.
  //
  // `/api/jkai/studio/image` is the same arrangement: scripts/studio-image.mjs
  // runs inside the build, holds the same per-build bridge token, and its
  // handler verifies it the same way before spending any model budget.
  if (
    pathname === '/api/jkai/tools/manifest' ||
    pathname === '/api/jkai/tools/invoke' ||
    pathname === '/api/jkai/studio/image' ||
    pathname === '/api/jkai/studio/research'
  ) {
    return resolve(event);
  }

  // /api/daydream/backfill POST is service-to-service: it pulls a month of
  // Home Assistant history into the daydream trail and is triggered from a
  // script, which has no user session. It self-authenticates via
  // `Authorization: Bearer DAYDREAM_MAINTENANCE_SECRET` and ALSO accepts an
  // owner session, so the button on /jkai/daydreams keeps working.
  //
  // Matched EXACTLY and POST-only, following the claude-changelog bypass above:
  // a prefix here would hand the exemption to every future `/api/daydream/*`
  // route, and `/api/daydream/thoughts` reads the owner's movements.
  if (pathname === '/api/daydream/backfill' && event.request.method === 'POST') {
    return resolve(event);
  }

  // /api/claude-changelog/ingest POST is service-to-service: the homeserv cron
  // scanner (scripts/claude-changelog/ingest.mjs) POSTs parsed transcripts and has
  // no user session. It self-authenticates via `Authorization: Bearer
  // CLAUDE_CHANGELOG_SECRET`, so the POST bypasses the Auth.js gate (mirrors
  // /api/policy-engine above). GET (debug summary) is deliberately NOT bypassed —
  // it falls through to the owner gate below (spec Decision Log #6: reads stay
  // owner-only).
  //
  // Matched EXACTLY, not by prefix — the same rule the tools/studio bypasses
  // above already follow. A prefix here silently hands the exemption to every
  // future `/api/claude-changelog/*` route somebody adds, which is how an
  // endpoint ends up unauthenticated without anyone choosing that. Today only
  // `/ingest` has a POST handler; the exemption should name it and no more.
  if (pathname === '/api/claude-changelog/ingest' && event.request.method === 'POST') {
    return resolve(event);
  }

  // /api/jkai/codegraph/{ingest,query} POST are service-to-service: the
  // homeserv backfill posts extracted graph units, and a running build reaches
  // the graph through `scripts/codegraph-query.mjs` over bash — bash being the
  // only transport pi has never stripped (all 5,214 recorded build actions are
  // pi built-ins; the site-tool bridge has never once been called). Both
  // self-authenticate with `Authorization: Bearer CLAUDE_CHANGELOG_SECRET` and
  // fail CLOSED when it is unset in production; /query additionally accepts an
  // owner session for chat and the UI.
  //
  // Exact pathnames, never a prefix — see the note above.
  if (
    (pathname === '/api/jkai/codegraph/ingest' || pathname === '/api/jkai/codegraph/query') &&
    event.request.method === 'POST'
  ) {
    return resolve(event);
  }

  // /api/releases/* POST is service-to-service: scripts/ci-deploy.sh records the
  // deploy from the GitHub Actions runner and scripts/release-log/ingest.mjs
  // drives the backfill from homeserv — neither has a user session. Both
  // handlers self-authenticate via `Authorization: Bearer RELEASE_LOG_SECRET`
  // (mirrors /api/claude-changelog above); /summarise additionally accepts an
  // owner session and refuses to run unauthenticated. GET is deliberately NOT
  // bypassed — it falls through to the owner gate below.
  if (pathname.startsWith('/api/releases/') && event.request.method === 'POST') {
    return resolve(event);
  }

  // /api/workflows/webhook/[id] is the INBOUND webhook trigger — external
  // services POST here with no user session (that is the entire point of a
  // webhook). The route requires a timestamped per-workflow HMAC signature,
  // rejects replay, and only fires workflows whose trigger type is 'webhook'.
  // Public client and global rate limits are applied before database work. Without this bypass the
  // owner-gate below 401s every external caller and webhooks are dead code.
  if (/^\/api\/workflows\/webhook\/[^/]+$/.test(pathname) && event.request.method === 'POST') {
    return resolve(event);
  }

  // /api/whatsapp/inbound is service-to-service: in delegated (production) mode
  // The WhatsApp worker relays owner messages here to run the approval-reply /
  // whatsapp-trigger intercepts, with no user session. The handler
  // self-authenticates via `Authorization: Bearer WHATSAPP_INBOUND_SECRET` (and
  // is disabled 503 if the secret is unset), so it bypasses the Auth.js gate
  // (mirrors /api/policy-engine above).
  if (pathname === '/api/whatsapp/inbound' && event.request.method === 'POST') {
    return resolve(event);
  }

  // The workflow-engine probe is consumed by the systemd watchdog timer (curl
  // from 127.0.0.1) — no user session, no service token. Restrict to loopback to
  // prevent it being scraped externally for run counts. Both paths are listed
  // while the watchdog unit is repointed off the /api/health prefix, which the
  // health application is due to take over.
  if (
    pathname === '/api/platform/workflow-engine' ||
    pathname === '/api/health/workflow-engine'
  ) {
    let clientAddr = '';
    try { clientAddr = event.getClientAddress?.() ?? ''; } catch { clientAddr = ''; }
    if (isLoopbackAddress(clientAddr)) {
      return resolve(event);
    }
  }

  // Maintenance endpoints (research re-index / source backfill) are driven by a
  // one-off run from the box (VPS loopback) carrying a shared secret, with no
  // user session — so they can't pass the owner-gate below. Let a valid
  // secret + loopback through here; the endpoint re-checks the secret
  // (defence-in-depth). An owner browser (no secret) falls through to the normal
  // owner-gate and still works.
  // /api/trails/segments is POST-ONLY here, unlike the others: the same path
  // answers GET with segment geometry, and a GPS trace starts at the front
  // door. A rebuild is an idempotent recompute of data already stored; handing
  // out where it happened is not.
  if (
    pathname === '/api/deepdive/index-sources' ||
    pathname === '/api/deepdive/reindex-facts' ||
    pathname === '/api/jkai/intel/backfill' ||
    pathname === '/api/jkai/intel/source-facets' ||
    pathname === '/api/jkai/intel/clusters/recalculate' ||
    pathname === '/api/jkai/intel/entities/split' ||
    (pathname === '/api/trails/segments' && event.request.method === 'POST')
  ) {
    let clientAddr = '';
    try { clientAddr = event.getClientAddress?.() ?? ''; } catch { clientAddr = ''; }
    if (isLoopbackAddress(clientAddr) && hasMaintenanceSecret(event.request)) {
      return resolve(event);
    }
  }

  // Studio builds can be started by a service credential as well as an owner
  // session — see $lib/server/studio-auth for why this one action is safe to
  // open and why it is not loopback-gated. Scoped to exactly this path and to
  // POST; everything else stays session-only. The route re-checks the token
  // itself (defence in depth), and the RATE_LIMITS entry below does not apply
  // to a tokened call, so the route enforces its own ceiling.
  if (pathname === '/api/jkai/studio' && event.request.method === 'POST' && hasStudioServiceToken(event.request)) {
    return resolve(event);
  }

  // The tool-invoke lane: Main serving its catalogue to a chat process that
  // does not live inside it. Service-to-service by construction — SR-JKAI has
  // no user session to present, and its gateway deliberately refuses a
  // client-supplied identity — so it self-authenticates on a bearer credential
  // (see $lib/server/invoke-auth for the two lanes and why the destructive one
  // is shut by default). Scoped to exactly this path and to POST; the route
  // re-checks the credential itself, defence in depth, and an unrecognised one
  // falls through to the owner gate below and 401s there.
  // The intel lane: the three calls chat makes to intel on the SERVER, which
  // become cross-process the day chat moves. Same credential as the tool lane —
  // it identifies SR-JKAI as the caller, and what it may DO is the tool lane's
  // question, not this one. Each route also accepts an owner session and
  // re-checks for itself, so this bypass only ever widens the tokened path.
  if (
    ((pathname === '/api/jkai/intel/chat-context' && event.request.method === 'POST') ||
      (pathname === '/api/jkai/intel/extract-thread' && event.request.method === 'POST') ||
      (pathname === '/api/jkai/intel/daily-alerts' && event.request.method === 'GET')) &&
    hasJkaiServiceToken(event.request)
  ) {
    return resolve(event);
  }

  // Named one path and verb at a time, like the bridge above it: neither is a
  // tree, so nothing new under /api/platform/tools is reachable by existing.
  if (
    ((pathname === '/api/platform/tools/invoke' && event.request.method === 'POST') ||
      (pathname === '/api/platform/tools/catalogue' && event.request.method === 'GET')) &&
    invokeLaneFor(event.request) !== 'none'
  ) {
    return resolve(event);
  }

  // The native lane: the iPhone companion reading chat and the news desk.
  //
  // This one IS a tree, which every bypass above it deliberately is not, so it
  // owes an explanation. The lanes above guard endpoints that already existed
  // for a browser and were later opened to one extra caller — naming each path
  // is what stops the next file added beside them inheriting the opening.
  // `/api/native` has no browser caller and never will: the whole subtree exists
  // only for this credential, so "everything under here" is the accurate rule
  // rather than a widening of somebody else's.
  //
  // What makes it safe is not the tree, it is `withDevice` in
  // `$lib/server/native-handler`: every handler under here resolves the identity
  // itself and 401s without one, so this bypass grants reachability and nothing
  // else. A new file that forgets is not a hole that opens quietly — it has no
  // session and no identity, so it cannot read anything.
  //
  // `/api/native/pair` is the deliberate exception and gates itself: it is the
  // one path that must answer a caller holding no device token yet, because
  // exchanging the one-time code is how a caller gets one.
  if (pathname.startsWith('/api/native/')) {
    // /api/native/pair gates itself and has its own per-address ceiling; every
    // other path here is behind a device token and gets the same per-caller
    // limits a browser session would.
    if (pathname !== '/api/native/pair') {
      const device = await nativeDevice(event.request);
      const capped = device ? rateLimited(pathname, event.request.method, `device:${device.id}`) : null;
      if (capped) return capped;
    }
    return resolve(event);
  }

  // The same credential, on the three orchestrator paths a turn actually needs:
  // POST to start one, GET to stream or poll it, DELETE to cancel.
  //
  // Named one path and verb at a time, like the bridges above — this is NOT a
  // tree, so nothing new under /api/workflows/orchestrator becomes reachable by
  // existing. The phone calls these directly rather than through a proxy under
  // /api/native because `handleWithLoop` is 590 lines of the busiest endpoint on
  // the site and reads nothing from the session: it is driven entirely by its
  // body. Lifting it into $lib to wrap it would be a refactor of chat itself,
  // carried out in a change about an iPhone app, for no behavioural gain.
  //
  // The credential is checked here rather than in the route because these
  // handlers are shared with the browser and must keep answering a session
  // exactly as they do today.
  if (
    (pathname === '/api/workflows/orchestrator/chat' ||
      pathname === '/api/workflows/orchestrator/chat/stream') &&
    ['GET', 'POST', 'DELETE', 'PATCH'].includes(event.request.method)
  ) {
    const device = await nativeDevice(event.request);
    if (device) {
      // The 10/min orchestrator cap lives INSIDE the owner-gate block below, and
      // this lane returns before reaching it — so without this a paired phone
      // could start chat turns without limit. Every turn is a paid model call
      // and the app retries on failure, so an unbounded lane is a cost hole, not
      // just a load one. Keyed on the DEVICE, so one phone stuck in a retry loop
      // cannot spend the browser's allowance too.
      const capped = rateLimited(pathname, event.request.method, `device:${device.id}`);
      if (capped) return capped;
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
    // default). The genuinely public / service-to-service APIs (vitals, agent,
    // jkai proxy, space-lander, scraper, mcp, policy-engine, …)
    // already returned earlier via isPublicPath and the explicit bypasses above,
    // so they never reach here. This subsumes the old /api/admin/* gate. Before
    // guests existed a session implied owner; introducing guests broke that
    // equivalence for every authed API, so gate them all here. (The homeserv LAN
    // bypass returns earlier still, so local access on the box is unaffected.)
    if (
      !isOwnerEmail(session.user.email) &&
      !isGuestAllowedPath(pathname) &&
      !(await memberMayReach(event))
    ) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Rate-limit expensive endpoints per authenticated user. Same helper the
    // device lanes use, so the ceilings cannot drift between the two.
    const userKey = (session.user as any).email || (session.user as any).id || 'anon';
    const capped = rateLimited(pathname, event.request.method, userKey);
    if (capped) return capped;

    return resolve(event);
  }

  // Public page routes — no auth required.
  //
  // /health is EXACT, and that is the whole point. The health hub now owns the
  // ground data too: /health/activities, /health/segments, /health/plan,
  // /health/routes and /health/record all carry GPS traces, and a GPS trace
  // starts at the front door. Under the old prefix rule every one of those
  // became anonymous the moment its directory existed — with no allowlist edit
  // to review and, because scripts/check-public-routes.mjs could not see this
  // array, a green gate. Written as explicit literals so that gate DOES see
  // them; they are classified in HOOK_EXACT_BYPASSES / HOOK_BYPASSES there.
  //
  // The page itself decides what an anonymous visitor gets: /health builds two
  // disjoint payloads and never sends the owner one to a browser without a
  // session (see its +page.server.ts).
  //
  // /tools stays a PREFIX — static/tools/* is a genuine tree.
  if (pathname === '/health') return resolve(event);
  if (pathname === '/tools' || pathname.startsWith('/tools/')) return resolve(event);

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
  if (
    !isOwnerEmail(session.user.email) &&
    !isGuestAllowedPath(pathname) &&
    !(await memberMayReach(event))
  ) {
    throw redirect(303, '/');
  }

  return resolve(event);
};

/**
 * A member (see $lib/server/members) may reach the exact routes and verbs in
 * `isMemberAllowedRoute` and nothing else. The route is checked first, so a
 * guest's request for anything outside that list costs no database read. What
 * the member then SEES is `resolveRequestScope`'s job, not this gate's.
 */
async function memberMayReach(event: Parameters<Handle>[0]['event']): Promise<boolean> {
  if (!isMemberAllowedRoute(event.route.id, event.request.method)) return false;
  try {
    return (await viewerOf(event)).kind === 'member';
  } catch (err) {
    // Fail closed: a member lookup that cannot reach the database refuses the
    // request, it does not wave it through.
    console.error('[auth] member lookup failed:', err);
    return false;
  }
}

const securityHeadersHandle: Handle = async ({ event, resolve }) => {
  let response: Response;
  try {
    response = await resolve(event);
  } catch (cause) {
    // SvelteKit normally materialises redirects after hooks have unwound,
    // which means early auth redirects miss the header layer. Materialise them
    // here so the same policy applies to every response.
    if (!isRedirect(cause)) throw cause;
    response = new Response(null, {
      status: cause.status,
      headers: { Location: cause.location },
    });
  }
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
    framePath === '/api/webframe/render' ||
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
  // `microphone=(self)`, NOT `microphone=()`. An empty allowlist disables the
  // feature for every origin INCLUDING this one, and a Permissions Policy is
  // checked BEFORE the permission prompt: `getUserMedia` then rejects with
  // NotAllowedError and the browser never asks. The site setting stays on
  // "Ask" — because nothing ever asked — so it looks exactly like a user
  // denial that site settings cannot fix. That shipped in #2, before the site
  // had a microphone at all, and silently broke the notebook's voice notes
  // (#711/#712), /capture and the chat recorder. Only widen this for a feature
  // the first-party site genuinely uses: camera, payment and usb stay closed.
  // Untrusted builder output is a different document and keeps the empty
  // allowlist — see safeGeneratedResponseHeaders in $lib/server/generated-content.
  if (!response.headers.has('Permissions-Policy')) {
    response.headers.set(
      'Permissions-Policy',
      'geolocation=(self), microphone=(self), camera=(), payment=(), usb=()',
    );
  }
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

// Header handling is outermost so auth redirects and early public/service
// responses cannot bypass it.
export const handle = sequence(securityHeadersHandle, authHandle, protectionHandle);
