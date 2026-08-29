/**
 * Paths that get past the Auth.js gate in `hooks.server.ts`, classified.
 *
 * ONE list, deliberately. This used to live inside
 * `scripts/check-public-routes.mjs`, which was fine while the CI gate was the
 * only reader. `/admin/estate` is now a second reader, and this codebase has
 * already learned what a second copy does: `public-api-paths.ts` says it in as
 * many words, and the sensitive-data detector taught the lesson by existing in
 * three copies that drifted. So the catalogue moved here and the script reads
 * it out of this file the same way it already reads `PUBLIC_PATHS` out of
 * `src/lib/auth.ts` — by extracting the literals, with canaries that fail loudly
 * if the extraction ever silently stops working.
 *
 * This file is DATA, not enforcement. `hooks.server.ts` is what actually lets a
 * request through; these arrays describe what it does so the surface can be
 * pinned and displayed. Keeping them honest is what
 * `assertNoUnclassifiedHookPaths` in the script is for: add a path literal to
 * the hook without classifying it here and CI fails.
 *
 * Server-only by name so it can never be pulled into a browser bundle — the
 * annotated map of every way into the estate is not client material.
 */

/**
 * Hook-level bypasses: paths `hooks.server.ts` lets through BEFORE the Auth.js
 * gate, each self-authenticating in its own handler (service tokens, bridge
 * tokens, HMAC). Curated deliberately rather than scraped, because the file
 * also contains path checks that are the OPPOSITE of a bypass — notably
 * `startsWith('/api/')`, which is the rule that ENFORCES auth on every API
 * route. Scraping picked that up and declared all 300+ /api routes public,
 * which is both wrong and useless.
 *
 * These are PREFIXES: an entry opens the path and everything beneath it.
 */
export const HOOK_BYPASSES: string[] = [
  '/dav', // Basic-Auth against webdav_credentials
  '/api/scraper/script', // SCRAPER_SERVICE_TOKEN
  '/api/mcp', // bridge token (tools/list + tools/call)
  '/api/policy-engine', // POLICY_INGEST_SECRET
  '/api/claude-changelog', // POST only, ingest secret
  '/api/releases', // POST only, RELEASE_LOG_SECRET (summarise also accepts an owner session)
  '/api/data-standard-designer',
  '/api/dfe-data-strategy',
  '/api/whatsapp/inbound', // POST only, WHATSAPP_INBOUND_SECRET
  '/api/health/workflow-engine', // watchdog probe
  '/api/deepdive/index-sources',
  '/api/deepdive/reindex-facts',
  '/api/jkai/intel/backfill', // loopback + MAINTENANCE_SECRET, re-checked in the handler
  '/api/jkai/intel/source-facets', // as above — both verbs re-check in the handler
  '/api/jkai/intel/clusters/recalculate', // as above; its own path so the secret cannot reach rename/narrate
  '/api/jkai/intel/entities/split', // as above; conflation repair, driven from the VPS against prod
  '/api/trails/segments', // POST ONLY — loopback + MAINTENANCE_SECRET, re-checked in the handler.
  // GET on the same path is NOT bypassed: it answers with segment geometry, and a
  // GPS trace starts at the front door. Only the idempotent rebuild is reachable.
  // Starting a studio build. POST only, STUDIO_SERVICE_TOKEN as a Bearer,
  // constant-time compared, refused entirely when the var is unset or under 32
  // chars — see $lib/server/studio-auth. Re-checked in the handler, which also
  // applies its own 3/hour ceiling because the hook's RATE_LIMITS pass is
  // skipped for a tokened call. Deliberately NOT loopback-gated: cloudflared
  // makes every VPS request look like 127.0.0.1, so loopback proves nothing
  // here. The action is reversible and cannot publish.
  '/api/jkai/studio', // POST only, STUDIO_SERVICE_TOKEN
  // Autonomous-builder tool bridge. HMAC-over-build-id bearer token, verified
  // in $lib/jkai/tool-bridge. Named one path at a time on purpose: the sibling
  // /api/jkai/tools/promote has NO auth of its own and must stay owner-gated.
  '/api/jkai/tools/manifest', // JKAI_BRIDGE_TOKEN
  '/api/jkai/tools/invoke', // JKAI_BRIDGE_TOKEN
  // Same bridge token, same reason: scripts/studio-image.mjs runs inside a
  // build with no session and draws one chapter illustration. POST only, and
  // the handler caps the subject length before it spends anything.
  '/api/jkai/studio/image', // JKAI_BRIDGE_TOKEN
  // Read-only search over research the owner has already gathered, POST only,
  // same per-build bridge token. Publishes no new data.
  '/api/jkai/studio/research', // JKAI_BRIDGE_TOKEN
  // The homeserv scanner posts extracted graph units here; the transcripts are
  // 858 MB and exist only on homeserv, so extraction cannot happen on the VPS.
  // POST only, Bearer CLAUDE_CHANGELOG_SECRET, and it FAILS CLOSED when that is
  // unset in production — which it was, from June until 2026-08-17, leaving an
  // unauthenticated write into claude_sessions open to the internet.
  '/api/claude-changelog/ingest', // CLAUDE_CHANGELOG_SECRET
  '/api/jkai/codegraph/ingest', // CLAUDE_CHANGELOG_SECRET
  // Read-only retrieval, POST only. Reached from a build by bash via
  // scripts/codegraph-query.mjs, and by the owner from chat and the UI.
  '/api/jkai/codegraph/query', // CLAUDE_CHANGELOG_SECRET or owner session
  // Pulls a month of Home Assistant history into the daydream trail. POST only,
  // Bearer DAYDREAM_MAINTENANCE_SECRET, and it FAILS CLOSED when that is unset:
  // no secret means no bearer can ever match, so an unset variable leaves the
  // route owner-session-only rather than open. Sibling `/api/daydream/thoughts`
  // reads the owner's movements and is deliberately NOT here — this is an exact
  // path, not a prefix.
  '/api/daydream/backfill', // POST only · DAYDREAM_MAINTENANCE_SECRET or owner session
];

/**
 * Page-level bypasses that are EXACT paths, not trees.
 *
 * These are the only two public PAGE routes. `/health` used to be a prefix,
 * which meant every file created under `src/routes/health/` was anonymously
 * reachable the instant it existed — and the gate script could not see it,
 * because the check was an array compared inside a callback rather than a
 * `pathname === '...'` literal, so the surface went unmonitored and the gate
 * stayed green. The health hub now owns the GPS data (activities, segments,
 * planner, recorder), so `/health` is matched exactly and its children fall
 * through to the owner gate. Listing it HERE rather than in `HOOK_BYPASSES` is
 * the point: an exact match is not a tree, so `/health` enters the snapshot on
 * its own and nothing underneath it does.
 */
export const HOOK_EXACT_BYPASSES: string[] = [
  '/health', // the public health landing; every /health/* child is owner-only
];

/** Prefix bypasses at the page level. `/tools` is a genuine tree (static/tools/*). */
export const HOOK_PAGE_PREFIX_BYPASSES: string[] = ['/tools'];

/**
 * Path literals in `hooks.server.ts` that are NOT bypasses, so drift detection
 * doesn't flag them every run.
 */
export const HOOK_NON_BYPASSES: string[] = [
  '/api', // the catch-all that REQUIRES auth for APIs
  '/projects', // share-token (?t=) handling; /projects is public via PUBLIC_PATHS
  // A 308 to the /health hub, emitted before the auth gate so a stale bookmark
  // lands somewhere instead of on /login with a dead callbackUrl. It grants no
  // access — the target is owner-gated like any other /health child — and no
  // route files live under src/routes/trails any more, so nothing enters the
  // inventory through it.
  '/trails',
];

/**
 * Short label for why a bypassed path is safe, keyed by the prefix. Used by
 * /admin/estate to say what stands in front of each open route instead of
 * leaving it looking unguarded. A prefix with no entry falls back to
 * "self-gated in the handler", which is the shared property of everything in
 * HOOK_BYPASSES.
 */
export const BYPASS_GUARDS: Record<string, string> = {
  '/dav': 'HTTP Basic · webdav_credentials',
  '/api/scraper/script': 'homeserv-only + SCRAPER_SERVICE_TOKEN',
  '/api/mcp': 'Bearer SERVICE_BRIDGE_SECRET',
  '/api/policy-engine': 'POLICY_INGEST_SECRET',
  '/api/data-standard-designer': 'DSD_INGEST_SECRET',
  '/api/dfe-data-strategy': 'KEYSTONE_INTEL_SECRET',
  '/api/claude-changelog': 'POST only · ingest secret',
  '/api/claude-changelog/ingest': 'POST only · Bearer CLAUDE_CHANGELOG_SECRET (fails closed)',
  '/api/daydream/backfill': 'POST only · Bearer DAYDREAM_MAINTENANCE_SECRET or owner session (fails closed)',
  '/api/releases': 'POST only · RELEASE_LOG_SECRET',
  '/api/whatsapp/inbound': 'POST only · Bearer WHATSAPP_INBOUND_SECRET',
  '/api/health/workflow-engine': 'loopback only · watchdog probe',
  '/api/deepdive/index-sources': 'loopback + MAINTENANCE_SECRET',
  '/api/deepdive/reindex-facts': 'loopback + MAINTENANCE_SECRET',
  '/api/jkai/intel/backfill': 'loopback + MAINTENANCE_SECRET',
  '/api/jkai/intel/source-facets': 'loopback + MAINTENANCE_SECRET',
  '/api/jkai/intel/clusters/recalculate': 'loopback + MAINTENANCE_SECRET',
  '/api/jkai/intel/entities/split': 'loopback + MAINTENANCE_SECRET',
  '/api/trails/segments': 'POST only · loopback + MAINTENANCE_SECRET (GET stays gated)',
  '/api/jkai/studio': 'POST only · STUDIO_SERVICE_TOKEN',
  '/api/jkai/tools/manifest': 'JKAI_BRIDGE_TOKEN',
  '/api/jkai/tools/invoke': 'JKAI_BRIDGE_TOKEN',
  '/api/jkai/studio/image': 'JKAI_BRIDGE_TOKEN',
  '/api/jkai/studio/research': 'JKAI_BRIDGE_TOKEN',
  '/api/jkai/codegraph/ingest': 'Bearer CLAUDE_CHANGELOG_SECRET',
  '/api/jkai/codegraph/query': 'CLAUDE_CHANGELOG_SECRET or owner session',
  '/health': 'public page · owner payload withheld without a session',
  '/tools': 'public static tree',
};
