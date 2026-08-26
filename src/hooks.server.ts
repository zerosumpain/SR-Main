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
import { requestHost } from '$lib/request-host';
import { resolveAdminRedirect } from '$lib/components/admin/admin-nav';
import { isEmailAllowedToSignIn, isOwnerEmail } from '$lib/server/access';
import { rateLimit } from '$lib/server/rate-limit';
import { hasMaintenanceSecret } from '$lib/server/maintenance-auth';
import { isPublicApiPath } from '$lib/server/public-api-paths';
import { hasStudioServiceToken } from '$lib/server/studio-auth';
import { isLoopbackAddress, isPrivateAddress } from '$lib/server/client-address';
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
  // Studio and Forge each kick off an autonomous multi-hour build (STUDIO_BUDGET:
  // up to $15 and 480 minutes). Unlike /builds these were unmatched entirely, so
  // a retry loop could queue them serially. 3/hour, not 3/minute.
  { pattern: /^\/api\/jkai\/(studio|forge)(\/|$)/, capacity: 3, refillPerSecond: 3 / 3600 }, // 3/hour
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

// Datastore TTL reaper + nightly self-improvement engine. The reaper sweeps
// expired records hourly; the self-improvement engine seeds its system
// collections on every boot and (in production only) schedules the nightly
// idle-time run. Neither belongs in the jkai-builder sidecar process.
import { startDatastoreReaper, stopDatastoreReaper } from '$lib/datastore';
import { startSelfImprovement, stopSelfImprovement } from '$lib/selfimprove/engine';
import { startVoiceDrift } from '$lib/voice/drift-engine';
// Nightly workflow doctor — triages node_executions failures, quarantines
// runaway schedules, proposes fixes. Structural sibling of selfimprove: same
// prod-only cron gate, same leader-elected lane, so it boots the same way.
import { startWorkflowDoctor, stopWorkflowDoctor } from '$lib/workflowdoctor/engine';
import { startBriefingEngine, stopBriefingEngine } from '$lib/briefing/engine';
import { startConnectorMonitor, stopConnectorMonitor } from '$lib/connectors/monitor';
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
if (process.env.JKAI_BUILDER_PROCESS !== '1') {
  startDatastoreReaper();
  startSelfImprovement();
  // Monthly, advisory only — it writes a note and never touches the card.
  startVoiceDrift();
  startWorkflowDoctor();
  startBriefingEngine();
  startConnectorMonitor();
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
  stopDatastoreReaper();
  stopSelfImprovement();
  stopWorkflowDoctor();
  stopBriefingEngine();
  stopConnectorMonitor();
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

  if (requestHost(event) === RETIRED_MAPS_HOST) {
    throw redirect(301, `https://strangeramblings.com${retiredMapsTarget(pathname)}`);
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

  // /api/jkai/prompts/hermes is service-to-service: the VPS prompt workbench
  // proxies here so it can read/write ~/.hermes-jkai/*.md, which only exist on
  // homeserv. Same shape as /api/scraper/script above — whitelist on homeserv
  // only; the handler still enforces the service token itself.
  if (pathname === '/api/jkai/prompts/hermes') {
    const { hostname } = await import('os');
    if (hostname() === 'homeserv' || process.env.HERMES_PROMPTS_LOCAL === '1') {
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
  // HERMES_BRIDGE_SECRET` inside the handlers themselves. They must
  // bypass the Auth.js gate so the VPS-originated tool calls from
  // homeserv's Hermes can land here on the VPS.
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

  // /api/workflows/webhook/[id] is the INBOUND webhook trigger — external
  // services POST here with no user session (that is the entire point of a
  // webhook). The route itself enforces the optional per-workflow secret
  // (X-Webhook-Secret, timing-safe) and only fires workflows whose trigger
  // type is 'webhook'; a rate limit is applied above. Without this bypass the
  // owner-gate below 401s every external caller and webhooks are dead code.
  if (/^\/api\/workflows\/webhook\/[^/]+$/.test(pathname) && event.request.method === 'POST') {
    return resolve(event);
  }

  // /api/whatsapp/inbound is service-to-service: in delegated (production) mode
  // Hermes relays owner WhatsApp messages here to run the approval-reply /
  // whatsapp-trigger intercepts, with no user session. The handler
  // self-authenticates via `Authorization: Bearer WHATSAPP_INBOUND_SECRET` (and
  // is disabled 503 if the secret is unset), so it bypasses the Auth.js gate
  // (mirrors /api/policy-engine above).
  if (pathname === '/api/whatsapp/inbound' && event.request.method === 'POST') {
    return resolve(event);
  }

  // /api/health/workflow-engine is consumed by the systemd watchdog timer
  // (curl from 127.0.0.1) — no user session, no service token. Restrict to
  // loopback to prevent it being scraped externally for run counts.
  if (pathname === '/api/health/workflow-engine') {
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
