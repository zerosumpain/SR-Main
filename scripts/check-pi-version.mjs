#!/usr/bin/env node
/**
 * Is the pi pin still pointing at something that exists?
 *
 * WHY THIS IS NOT `npm view <pkg> version`
 *
 * The obvious check — compare the pin against npm's `latest` — is exactly the
 * check that failed. Upstream renamed pi from `@mariozechner/pi-coding-agent`
 * to `@earendil-works/pi-coding-agent` and stopped publishing under the old
 * name at 0.73.1, which is the version we pin. So for sixteen weeks:
 *
 *     $ npm view @mariozechner/pi-coding-agent version
 *     0.73.1          <- our exact pin. "You are up to date."
 *
 * while upstream shipped eleven minors under the new name. A dist-tag on an
 * abandoned package does not go stale, it goes STILL, and still is
 * indistinguishable from current if npm is the only thing you ask.
 *
 * So this asks TWO independent sources and treats their DISAGREEMENT as the
 * signal:
 *
 *   1. npm, for the pinned package name.
 *   2. GitHub, for the pinned upstream repo — which answers a moved repo with
 *      a 301 to its new canonical name. That redirect is the rename telling us
 *      its new address, and it is how this was found by hand in the first place.
 *
 * Verdicts, worst first. Any of them exits non-zero.
 *
 *   MOVED      the repo now lives somewhere else. Update jkai.piUpstreamRepo,
 *              and expect jkai.piPackage to have changed too.
 *   ABANDONED  npm says we are current, GitHub says there are newer releases.
 *              This is the shape that was missed. It means the name we install
 *              from is dead and the project moved.
 *   BEHIND     an ordinary upgrade is available under the same name.
 *   STALE      npm has not published in a long time and we cannot reach GitHub
 *              to corroborate. Not proof of anything — worth a look.
 *   CURRENT    both sources agree we are on the newest release.
 *
 * It NEVER installs anything. Upgrading pi stays the deliberate path — move the
 * pin in a PR, prove it with a canary build, then `scripts/deploy-builder.sh`
 * (see the `dependency-upgrades` skill). This only decides when to start.
 *
 *   node scripts/check-pi-version.mjs           # human-readable, exits non-zero on drift
 *   node scripts/check-pi-version.mjs --json    # same verdict as JSON
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const PIN = pkg.jkai?.piVersion;
const PACKAGE = pkg.jkai?.piPackage;
const REPO = pkg.jkai?.piUpstreamRepo;

if (!PIN || !PACKAGE || !REPO) {
  console.error('package.json needs jkai.piVersion, jkai.piPackage and jkai.piUpstreamRepo');
  process.exit(2);
}

/** Compare two bare semvers. Returns >0 when a is newer. */
function cmp(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

const TIMEOUT_MS = 20_000;
async function getJson(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // `redirect: 'manual'` on purpose for the GitHub call: a 301 is the ANSWER,
    // not something to transparently follow past. Node follows by default and
    // the rename would vanish into a successful 200 for the new repo.
    const res = await fetch(url, { headers: { 'user-agent': 'sr-main-pi-pin-check', ...headers }, signal: ctrl.signal, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      return { moved: true, location: res.headers.get('location') };
    }
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { body: await res.json() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(t);
  }
}

const out = { pin: PIN, package: PACKAGE, repo: REPO };

// --- npm ---
const npm = await getJson(`https://registry.npmjs.org/${PACKAGE.replace('/', '%2f')}`);
if (npm.error) {
  out.npm = { error: npm.error };
} else if (npm.body) {
  const latest = npm.body['dist-tags']?.latest;
  const published = npm.body.time?.[latest];
  out.npm = {
    latest,
    publishedAt: published,
    daysSincePublish: published ? Math.floor((Date.now() - Date.parse(published)) / 86_400_000) : null,
  };
}

// --- GitHub ---
const ghHeaders = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
const repoRes = await getJson(`https://api.github.com/repos/${REPO}`, ghHeaders);
if (repoRes.moved) {
  // The redirect target is the numeric-id form; resolve it to a name.
  const canonical = await getJson(repoRes.location, ghHeaders);
  out.github = { moved: true, newRepo: canonical.body?.full_name ?? repoRes.location };
} else if (repoRes.error) {
  out.github = { error: repoRes.error };
} else {
  const rel = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`, ghHeaders);
  const tag = rel.body?.tag_name;
  out.github = tag
    ? { latestRelease: tag.replace(/^v/, ''), publishedAt: rel.body?.published_at }
    : { error: rel.error ?? 'no releases' };
}

// --- verdict ---
const npmLatest = out.npm?.latest;
const ghLatest = out.github?.latestRelease;
let verdict, detail;

if (out.github?.moved) {
  verdict = 'MOVED';
  detail = `upstream repo ${REPO} now redirects to ${out.github.newRepo}. The npm package almost certainly moved with it — check its scope and update jkai.piPackage and jkai.piUpstreamRepo together.`;
} else if (npmLatest && ghLatest && cmp(npmLatest, PIN) <= 0 && cmp(ghLatest, npmLatest) > 0) {
  verdict = 'ABANDONED';
  detail = `npm reports ${PACKAGE}@${npmLatest} as latest — the pin — but ${REPO} has released ${ghLatest}. The package name we install from has stopped moving while the project has not. Find where it publishes now.`;
} else if (npmLatest && cmp(npmLatest, PIN) > 0) {
  verdict = 'BEHIND';
  detail = `${PACKAGE}@${npmLatest} is available (pinned ${PIN}). Upgrade via the dependency-upgrades skill: move the pin in a PR, canary it, then scripts/deploy-builder.sh.`;
} else if (npmLatest && out.npm.daysSincePublish !== null && out.npm.daysSincePublish > 90 && !ghLatest) {
  verdict = 'STALE';
  detail = `${PACKAGE} has not published for ${out.npm.daysSincePublish} days and GitHub could not be reached to corroborate (${out.github?.error}). Not proof of a problem — but this is what a rename looks like from npm alone.`;
} else if (!npmLatest) {
  verdict = 'UNKNOWN';
  detail = `could not read npm (${out.npm?.error ?? 'no dist-tag'}).`;
} else {
  verdict = 'CURRENT';
  detail = `pinned ${PIN}; npm latest ${npmLatest}${ghLatest ? `, ${REPO} latest release ${ghLatest}` : ''}.`;
}

out.verdict = verdict;
out.detail = detail;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`pi pin check: ${verdict}`);
  console.log(`  pinned      ${PACKAGE}@${PIN}`);
  console.log(`  npm latest  ${npmLatest ?? out.npm?.error ?? '?'}${out.npm?.daysSincePublish != null ? `  (published ${out.npm.daysSincePublish}d ago)` : ''}`);
  console.log(`  ${REPO}  ${out.github?.moved ? `MOVED -> ${out.github.newRepo}` : (ghLatest ?? out.github?.error ?? '?')}`);
  console.log(`\n  ${detail}`);
}

process.exit(verdict === 'CURRENT' ? 0 : 1);
