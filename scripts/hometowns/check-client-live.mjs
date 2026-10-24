#!/usr/bin/env node
// The Hometowns release gate (spec §10.10, §13.4): the map page for the
// current PAGE_HASH must already be live before the change that names it
// merges (an engine change or a page-only one), because the wire tells every
// phone to load /projects/hometowns/<PAGE_HASH>/mobile.html.
//
//   node scripts/hometowns/check-client-live.mjs                 # strangeramblings.com
//   node scripts/hometowns/check-client-live.mjs --site <origin> # another host
//
// Exit 0 only when that URL returns 200 text/html with the first-party CSP
// (no sandbox, or the page's module worker cannot start), the page's own
// <meta name="hometowns-page-hash"> names the same page and its
// <meta name="hometowns-engine-hash"> the engine the server runs. Otherwise
// it says what is wrong and exits 1. Publish the page with
// scripts/hometowns/deploy-page.sh, then rerun this.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_DIR, GENERATED, computeEngineHash } from './engine-hash.mjs';
import { GENERATED_PAGE, REPO, computePageHash } from './page-hash.mjs';

export const DEFAULT_SITE = 'https://strangeramblings.com';
export const ENGINE_META = 'hometowns-engine-hash';
export const PAGE_META = 'hometowns-page-hash';

/** The hash engine-hash.generated.ts declares (the wire's engineHash). */
export function generatedHash(dir = ENGINE_DIR) {
  const src = readFileSync(join(dir, GENERATED), 'utf8');
  const m = /export const ENGINE_HASH = '([0-9a-f]{16})';/.exec(src);
  if (!m) throw new Error(`no ENGINE_HASH in ${GENERATED}`);
  return m[1];
}

/** The hash page-hash.generated.ts declares (the folder the wire names). */
export function generatedPageHash(root = REPO) {
  const src = readFileSync(join(root, GENERATED_PAGE), 'utf8');
  const m = /export const PAGE_HASH = '([0-9a-f]{16})';/.exec(src);
  if (!m) throw new Error(`no PAGE_HASH in ${GENERATED_PAGE}`);
  return m[1];
}

export function pageUrl(site, pageHash) {
  return `${site.replace(/\/+$/, '')}/projects/hometowns/${pageHash}/mobile.html`;
}

/** The engine hash a built or served mobile.html carries, or null. */
export function engineHashMarker(html) {
  const m = new RegExp(`<meta name="${ENGINE_META}" content="([0-9a-f]+)"`).exec(html);
  return m ? m[1] : null;
}

/** The page hash a built or served mobile.html carries, or null. */
export function pageHashMarker(html) {
  const m = new RegExp(`<meta name="${PAGE_META}" content="([0-9a-f]+)"`).exec(html);
  return m ? m[1] : null;
}

/**
 * Fetch the page for `pageHash` and judge it, including that it runs
 * `engineHash`. Returns `{ ok, url, problem? }`; never throws for a network
 * failure (that is a not-live answer too).
 */
export async function checkClientLive({ pageHash, engineHash, site = DEFAULT_SITE, fetchImpl = fetch, timeoutMs = 20_000 }) {
  const url = pageUrl(site, pageHash);
  let res;
  try {
    res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    return { ok: false, url, problem: `request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (res.status !== 200) {
    return { ok: false, url, problem: `HTTP ${res.status}: the page for ${pageHash} is not published (scripts/hometowns/deploy-page.sh)` };
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('text/html')) return { ok: false, url, problem: `content type '${type}', not text/html` };
  const csp = res.headers.get('content-security-policy') ?? '';
  if (!csp || /(^|;)\s*sandbox\b/.test(csp)) {
    return { ok: false, url, problem: "served with the sandboxed CSP: 'hometowns' is not a live STATIC_PROJECT_KEYS entry" };
  }
  const html = await res.text();
  const served = pageHashMarker(html);
  if (served !== pageHash) return { ok: false, url, problem: `the served page's page-hash marker is ${served ?? 'missing'}, not ${pageHash}` };
  const engine = engineHashMarker(html);
  if (engine !== engineHash) return { ok: false, url, problem: `the served page runs engine ${engine ?? 'missing'}, not ${engineHash}` };
  return { ok: true, url };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--site');
  const site = i > 0 ? process.argv[i + 1] : (process.env.HOMETOWNS_SITE ?? DEFAULT_SITE);
  const engineHash = generatedHash();
  const fresh = computeEngineHash();
  if (fresh !== engineHash) {
    console.error(`ENGINE_HASH is stale (the engine hashes to ${fresh}, the file says ${engineHash}); run node scripts/hometowns/engine-hash.mjs`);
    process.exit(1);
  }
  const pageHash = generatedPageHash();
  const freshPage = computePageHash();
  if (freshPage !== pageHash) {
    console.error(`PAGE_HASH is stale (the page hashes to ${freshPage}, the file says ${pageHash}); run node scripts/hometowns/page-hash.mjs`);
    process.exit(1);
  }
  const r = await checkClientLive({ pageHash, engineHash, site });
  if (r.ok) {
    console.log(`Hometowns page ${pageHash} (engine ${engineHash}) is live: ${r.url}`);
  } else {
    console.error(`Hometowns page ${pageHash} (engine ${engineHash}) is NOT live: ${r.problem}\n  ${r.url}`);
    process.exit(1);
  }
}
