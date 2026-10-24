#!/usr/bin/env node
// The Hometowns release gate (spec §10.10, §13.4): the map page for the
// current ENGINE_HASH must already be live before the engine change that
// names it merges, because the wire tells every phone to load
// /projects/hometowns/<ENGINE_HASH>/mobile.html.
//
//   node scripts/hometowns/check-client-live.mjs                 # strangeramblings.com
//   node scripts/hometowns/check-client-live.mjs --site <origin> # another host
//
// Exit 0 only when that URL returns 200 text/html with the first-party CSP
// (no sandbox, or the page's module worker cannot start) and the page's own
// <meta name="hometowns-engine-hash"> names the same hash. Otherwise it says
// what is wrong and exits 1. Publish the page with
// scripts/hometowns/deploy-page.sh, then rerun this.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_DIR, GENERATED, computeEngineHash } from './engine-hash.mjs';

export const DEFAULT_SITE = 'https://strangeramblings.com';
export const HASH_META = 'hometowns-engine-hash';

/** The hash engine-hash.generated.ts declares (the one the wire will name). */
export function generatedHash(dir = ENGINE_DIR) {
  const src = readFileSync(join(dir, GENERATED), 'utf8');
  const m = /export const ENGINE_HASH = '([0-9a-f]{16})';/.exec(src);
  if (!m) throw new Error(`no ENGINE_HASH in ${GENERATED}`);
  return m[1];
}

export function pageUrl(site, hash) {
  return `${site.replace(/\/+$/, '')}/projects/hometowns/${hash}/mobile.html`;
}

/** The hash a built or served mobile.html carries, or null. */
export function pageHashMarker(html) {
  const m = new RegExp(`<meta name="${HASH_META}" content="([0-9a-f]+)"`).exec(html);
  return m ? m[1] : null;
}

/**
 * Fetch the page for `hash` and judge it. Returns `{ ok, url, problem? }`;
 * never throws for a network failure (that is a not-live answer too).
 */
export async function checkClientLive({ hash, site = DEFAULT_SITE, fetchImpl = fetch, timeoutMs = 20_000 }) {
  const url = pageUrl(site, hash);
  let res;
  try {
    res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    return { ok: false, url, problem: `request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (res.status !== 200) {
    return { ok: false, url, problem: `HTTP ${res.status}: the page for ${hash} is not published (scripts/hometowns/deploy-page.sh)` };
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('text/html')) return { ok: false, url, problem: `content type '${type}', not text/html` };
  const csp = res.headers.get('content-security-policy') ?? '';
  if (!csp || /(^|;)\s*sandbox\b/.test(csp)) {
    return { ok: false, url, problem: "served with the sandboxed CSP: 'hometowns' is not a live STATIC_PROJECT_KEYS entry" };
  }
  const served = pageHashMarker(await res.text());
  if (served !== hash) return { ok: false, url, problem: `the served page's hash marker is ${served ?? 'missing'}, not ${hash}` };
  return { ok: true, url };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--site');
  const site = i > 0 ? process.argv[i + 1] : (process.env.HOMETOWNS_SITE ?? DEFAULT_SITE);
  const hash = generatedHash();
  const fresh = computeEngineHash();
  if (fresh !== hash) {
    console.error(`ENGINE_HASH is stale (the engine hashes to ${fresh}, the file says ${hash}); run node scripts/hometowns/engine-hash.mjs`);
    process.exit(1);
  }
  const r = await checkClientLive({ hash, site });
  if (r.ok) {
    console.log(`Hometowns page ${hash} is live: ${r.url}`);
  } else {
    console.error(`Hometowns page ${hash} is NOT live: ${r.problem}\n  ${r.url}`);
    process.exit(1);
  }
}
