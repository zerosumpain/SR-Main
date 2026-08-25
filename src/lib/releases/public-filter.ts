/**
 * Public-safety filter for the release log.
 *
 * The release log at /admin/ops/releases is owner-only and holds the full truth:
 * internal infra work, file paths, commit shas, and items describing security
 * mechanisms. The landing page showcases the same body of work to anonymous
 * visitors, so everything served publicly passes through here first.
 *
 * The rule is allow-list first, deny-list second — an item is public only when
 * it is user-facing AND touches no private surface AND reads clean. Anything
 * this module is unsure about stays private; under-showing is free. Measured
 * against production on 2026-07-29: 357 of 1,056 items survive, spread over 211
 * of the 418 releases and the whole date range.
 *
 * Dropping prose that names source paths, /api routes, env vars or hosts is a
 * double win: it removes the structural map of a private repo, and it removes
 * exactly the entries that read like a commit message rather than a capability.
 *
 * NOTE for local QA: homeserv's `project_visibility` table is staler and more
 * permissive than production's, so the dev page shows MORE than the live one.
 * Verify counts against prod before trusting them.
 *
 * Pure by design so it can be unit-tested without a database — the caller
 * supplies the project-visibility map (see $lib/projects/visibility).
 */
import { defaultsPublic } from '$lib/projects/visibility';

import type { ReleaseItemKind } from './types';

/** The subset of a release_items row this filter needs. */
export interface FilterableItem {
  kind: ReleaseItemKind | string;
  impact: string;
  title: string;
  summary: string;
  surfaces: string[];
  /** 'low' | 'medium' | 'high' — the summariser's own confidence. */
  confidence?: string;
}

/**
 * Text that describes how the site is defended — or how it once wasn't.
 *
 * A public changelog entry reading "auth bypass extended for Tailscale clients
 * and env flag" is a disclosure, not a feature announcement: it names a real
 * production escape hatch. Same for the SSRF-guard hardening items, which
 * describe the bypass that was possible before the fix. These stay owner-only
 * regardless of how their `impact` was classified.
 *
 * Matched case-insensitively against title and summary together.
 */
const SENSITIVE = [
  // An /admin path named in the prose is the same disclosure as one named in
  // `surfaces` — the surfaces test alone misses it (e.g. "replacing the old
  // /admin/connections/files"). Bare /api paths are deliberately NOT here:
  // every /api route is 401-gated by hooks.server.ts, so naming one describes
  // a door that is locked, not a weakness.
  '/admin',
  'auth_bypass',
  'auth bypass',
  'bypass',
  'ssrf',
  'secret',
  'token encryption',
  'api key',
  'api_key',
  'password',
  'credential',
  'vault',
  'encryption key',
  '_key',
  'private key',
  '\\.env',
  'rate.?limit',
  'csrf',
  'xss',
  'injection',
  'allow.?list',
  'deny.?list',
];
const SENSITIVE_RE = new RegExp(`(${SENSITIVE.join('|')})`, 'i');

/**
 * Names of the machines, tunnels and daemons behind the site.
 *
 * None of this is a password, but together it is a topology: which host runs
 * what, how traffic reaches it, what the private network is called. A showcase
 * has no need of any of it.
 */
const INFRA_RE =
  /\b(homeserv|tailscale|tail668b8c|hetzner|cloudflared|caddy|authelia|systemd|docker|pm2|nginx|localhost|127\.0\.0\.1|\d{1,3}(\.\d{1,3}){3})\b/i;

/**
 * UPPER_SNAKE_CASE tokens — environment variables and feature flags.
 *
 * Naming a variable is not leaking its value, but it does tell a reader exactly
 * which levers exist and what to go looking for (`CURATE_WORKSPACE_DIR`,
 * `PUBLIC_SITE_URL`, `JKAI_HERMES_CANVAS_CHAT`). Needs two segments so ordinary
 * shouty prose and acronyms ("SSR", "API", "UK") do not match.
 */
const ENV_VAR_RE = /\b[A-Z][A-Z0-9]{1,}(_[A-Z0-9]+)+\b/;

/**
 * Source paths and filenames written into the prose.
 *
 * `redactItem` already refuses to emit the structured `files[]` evidence, but
 * the LLM-written summary frequently restates it ("moved into src/lib/threlte/",
 * "the +layout.svelte gained…"). Dropping these is a double win: it removes the
 * structural map of a private repo, and it removes exactly the items whose prose
 * reads like a commit message instead of a capability.
 */
const CODE_PATH_RE =
  /(\b(src|scripts|packages|static|docs|drizzle|supabase)\/[\w./[\]-]*|\b[\w+-]+\.(ts|tsx|js|mjs|cjs|svelte|css|html|sql|py|sh|yml|yaml|toml)\b|\+(page|layout|server)\b)/i;

/** Any /api path named in prose. Harmless alone, but it is implementation noise. */
const API_PATH_RE = /\/api\//i;

/**
 * Personal data quoted in a summary.
 *
 * Caught in production: a WhatsApp JID fix whose summary quoted the real
 * number it was failing on — "Panel-formatted numbers like '+44 7359228511'
 * retained the space". Nothing else in this module came close to catching it.
 * It is not a secret, an env var, a host or a path; it is simply a phone
 * number sitting in ordinary prose, and the only reason it was in the commit
 * message is that it was the test case.
 *
 * That is the general shape of the risk: bug reports quote the data that
 * triggered the bug. So this matches personal identifiers broadly and drops
 * the whole item rather than trying to redact mid-sentence.
 *
 * Long digit runs are deliberately included. They cost almost nothing — a
 * legitimate summary rarely needs a bare 7+ digit number — and they catch
 * account ids, JIDs and phone numbers written without punctuation.
 */
const PII_RE = new RegExp(
  [
    // +44 7700 900123, +447700900123, (0)7700-900123 …
    '\\+\\d[\\d\\s()-]{7,}\\d',
    // UK mobile/landline in national form
    '\\b0?7\\d{3}[\\s-]?\\d{6}\\b',
    // Any bare run of 7+ digits (JIDs, account ids, phone numbers)
    '\\b\\d{7,}\\b',
    // Email addresses
    '[\\w.+-]+@[\\w-]+\\.[\\w.]{2,}',
    // UK postcodes
    '\\b[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}\\b',
    // Lat/long pairs precise enough to locate a person
    '\\b-?\\d{1,3}\\.\\d{4,}\\s*,\\s*-?\\d{1,3}\\.\\d{4,}\\b',
  ].join('|'),
);

/**
 * Surfaces that must never appear in public output.
 *
 * `/admin` is owner-only, and naming its sub-routes to the world is free
 * reconnaissance. `/api` internals are the same. Private /projects pages are
 * handled separately and dynamically, because their visibility is a runtime
 * toggle rather than a constant.
 */
const PRIVATE_SURFACE_RE = /(^|\/)(admin|api)(\/|$)/i;

/** Pull the /projects/<key> slug out of a surface string, if it is one. */
export function projectKeyOf(surface: string): string | null {
  const m = /^\/projects\/([^/\s]+)/.exec(surface.trim());
  if (!m) return null;
  // Route params like /projects/[slug] name no real project.
  if (m[1].startsWith('[')) return null;
  return m[1];
}

/**
 * True when a surface string is safe to show to an anonymous visitor.
 *
 * `visibility` is the project_visibility map — absence of a key means public,
 * matching $lib/projects/visibility.isProjectPublic. Prose surfaces that name
 * no route at all ("workflow engine") are safe: they describe capability, not
 * location.
 */
export function isSurfacePublic(surface: string, visibility: Record<string, boolean>): boolean {
  const s = surface.trim();
  if (!s) return false;
  if (PRIVATE_SURFACE_RE.test(s)) return false;
  if (INFRA_RE.test(s) || ENV_VAR_RE.test(s)) return false;

  const key = projectKeyOf(s);
  if (key !== null) {
    // A `surfaces` entry is LLM-written prose, not a foreign key, so slugs drift
    // ("/projects/compound-interest/" against a row keyed
    // compound-interest-calculator). An exact miss must not read as "public" —
    // fail CLOSED here and require a positive match, the opposite of
    // isProjectPublic's site-wide default.
    //
    // With no row at all, defer to the key's own default: a hand-built page is
    // public, an AI build's slug is not. Naming a build the site 404s would
    // advertise a page nobody can open.
    if (!(visibility[key] ?? defaultsPublic(key))) return false;
    return !Object.keys(visibility).some(
      (k) => visibility[k] === false && (k.startsWith(key) || key.startsWith(k)),
    );
  }

  if (s.startsWith('/')) {
    // A real route, already cleared of /admin, /api and private projects. A dot
    // means it is a file being described as a route (/jkai/+layout.server.ts),
    // not somewhere a visitor can go — except the two published feed routes.
    if (s === '/rss.xml' || s === '/sitemap.xml') return true;
    return !s.includes('.');
  }

  // Not a route at all. Only a short human label ("workflow engine", "canvas")
  // is allowed through — anything carrying a slash or a dot is a file path, and
  // src/app.d.ts is not a "surface" a visitor can visit.
  if (s.includes('/') || s.includes('.')) return false;
  return s.length <= 40;
}

/**
 * True when a whole release item may be shown publicly.
 *
 * Note the surfaces test is "every", not "some": an item that touches both a
 * public page and /admin still describes work on /admin, so it goes. An item
 * with no surfaces at all is judged on impact and text alone.
 */
export function isItemPublic(item: FilterableItem, visibility: Record<string, boolean>): boolean {
  if (item.impact !== 'user-facing') return false;

  // The summariser records its own uncertainty, and a low-confidence entry
  // reads like one: "Minor Jkai canvas page update — likely a UI tweak. No
  // further details available from the commit evidence." Six such items exist,
  // and they cluster at the recent end where the landing page looks, so a
  // showcase fronted by them undersells everything behind it.
  if (item.confidence === 'low') return false;

  const prose = `${item.title} ${item.summary}`;
  if (SENSITIVE_RE.test(prose)) return false;
  if (INFRA_RE.test(prose)) return false;
  if (ENV_VAR_RE.test(prose)) return false;
  // Structural detail in the prose is judged on the whole item, not stripped
  // from the sentence — a half-redacted summary reads worse than no summary.
  if (CODE_PATH_RE.test(prose)) return false;
  if (API_PATH_RE.test(prose)) return false;
  if (PII_RE.test(prose)) return false;

  const surfaces = item.surfaces ?? [];
  // A surface naming a private route condemns the item; a surface that is
  // merely un-showable (a file path) does not — redactItem drops those.
  return surfaces.every(
    (s) => isSurfacePublic(s, visibility) || !isPrivateSurface(s, visibility),
  );
}

/** True when a surface names something the public must not learn about. */
function isPrivateSurface(surface: string, visibility: Record<string, boolean>): boolean {
  const s = surface.trim();
  if (PRIVATE_SURFACE_RE.test(s) || INFRA_RE.test(s) || ENV_VAR_RE.test(s)) return true;
  const key = projectKeyOf(s);
  if (key === null) return false;
  if (!(visibility[key] ?? defaultsPublic(key))) return true;
  return Object.keys(visibility).some(
    (k) => visibility[k] === false && (k.startsWith(key) || key.startsWith(k)),
  );
}

/** Convenience wrapper — filter a list of items down to the publicly safe ones. */
export function publicItems<T extends FilterableItem>(
  items: T[],
  visibility: Record<string, boolean>,
): T[] {
  return items.filter((i) => isItemPublic(i, visibility));
}

/**
 * Strip an item down to the fields that are safe to serialise.
 *
 * File paths and commit shas are dropped wholesale: they map the private
 * repository's internal structure and add nothing to a showcase. `surfaces`
 * survives but re-filtered, so a public item never lists a private route even
 * when the item as a whole passed.
 */
export function redactItem<T extends FilterableItem>(
  item: T,
  visibility: Record<string, boolean>,
): Omit<FilterableItem, 'impact'> & { surfaces: string[] } {
  return {
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    surfaces: (item.surfaces ?? []).filter((s) => isSurfacePublic(s, visibility)),
  };
}
