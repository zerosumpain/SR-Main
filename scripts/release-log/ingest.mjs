// Release-log ingester.
//
// Usage:
//   node ingest.mjs --head [--prev <sha>]     # record the deploy that just happened (CI)
//   node ingest.mjs --backfill                # reconstruct history from git (one-off)
//   node ingest.mjs --summarise               # drive the LLM pass until nothing is pending
//   node ingest.mjs --backfill --dry          # parse + report, POST nothing
//
// Flags:
//   --prev <sha>        commit being replaced (CI reads it from the old build/.deploy-sha)
//   --via <source>      github-actions | manual | backfill  (default: github-actions for --head)
//   --deployed-at <iso> deploy timestamp (default: now for --head, commit date for --backfill)
//   --built-at <iso>    build timestamp from build/.deploy-sha
//   --gap <seconds>     backfill clustering gap (default 2700)
//   --limit <n>         backfill: only the newest N reconstructed releases
//   --batch <n>         summarise: releases per request (default 5, server max 25)
//   --retry-failed      summarise: also retry releases whose last pass failed
//   --repo <path>       repo to read (default: this script's repo)
//
// Env:
//   RELEASE_LOG_URL     site base URL (default: https://strangeramblings.com)
//   RELEASE_LOG_TOKEN   shared bearer token (RELEASE_LOG_SECRET on the server)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectHistory, collectRelease, git, DEFAULT_GAP_SECONDS } from './collect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = path.resolve(HERE, '..', '..');
const BASE = (process.env.RELEASE_LOG_URL || 'https://strangeramblings.com').replace(/\/$/, '');
const TOKEN = process.env.RELEASE_LOG_TOKEN || '';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const DRY = has('--dry');
const REPO = value('--repo', DEFAULT_REPO);

async function post(pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${pathname} → ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** Record the commit currently checked out as a production release. */
async function runHead() {
  const sha = git(['rev-parse', 'HEAD'], REPO).trim();
  let prev = value('--prev', '') || null;
  if (prev === sha) {
    console.log(`release-log: HEAD ${sha.slice(0, 8)} is already the deployed commit — nothing to record.`);
    return;
  }
  // A prev sha that isn't in this clone (shallow checkout, force-push) would
  // make the range meaningless — fall back to "just this commit".
  if (prev) {
    try {
      git(['cat-file', '-e', `${prev}^{commit}`], REPO);
    } catch {
      console.warn(`release-log: prev sha ${prev.slice(0, 8)} not found in this clone — recording HEAD only.`);
      prev = null;
    }
  }

  const payload = collectRelease(prev, sha, REPO, {
    via: value('--via', 'github-actions'),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], REPO).trim(),
    deployedAt: value('--deployed-at', new Date().toISOString()),
    builtAt: value('--built-at', null),
  });

  console.log(
    `release-log: ${payload.shortSha} ← ${payload.prevSha?.slice(0, 8) ?? 'root'} · ` +
      `${payload.stats.commits} commits · ${payload.stats.files} files · +${payload.stats.insertions}/-${payload.stats.deletions}`,
  );
  if (DRY) return;
  const result = await post('/api/releases/ingest', payload);
  console.log(`release-log: recorded ${result.version ?? '?'}${result.skipped ? ` (${result.skipped})` : ''}`);
}

/** Reconstruct the history that predates the releases table. */
async function runBackfill() {
  const gap = Number(value('--gap', DEFAULT_GAP_SECONDS));
  const branch = value('--branch', 'master');
  let payloads = collectHistory(branch, REPO, { gapSeconds: gap, branch });
  const limit = Number(value('--limit', 0));
  if (limit > 0) payloads = payloads.slice(-limit);

  console.log(`release-log: ${payloads.length} releases reconstructed from ${branch} (gap ${gap}s)`);
  if (DRY) {
    for (const p of payloads.slice(-10)) {
      console.log(
        `  ${p.deployedAt.slice(0, 16)}  ${p.shortSha}  ${String(p.stats.commits).padStart(3)} commits  ` +
          `${String(p.stats.files).padStart(3)} files  ${p.commits[0]?.subject.slice(0, 70) ?? ''}`,
      );
    }
    if (payloads.length > 10) console.log(`  …(showing the newest 10 of ${payloads.length})`);
    return;
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const payload of payloads) {
    try {
      // summarise=0: the backfill must not fire hundreds of concurrent LLM
      // calls. `--summarise` drives that pass afterwards, rate-limited.
      const result = await post('/api/releases/ingest?summarise=0', payload);
      if (result.skipped) skipped++;
      else ok++;
    } catch (err) {
      failed++;
      console.error(`  ${payload.shortSha}: ${err.message}`);
    }
  }
  console.log(`release-log: ${ok} recorded, ${skipped} already present, ${failed} failed`);
}

/** Drive the server-side LLM pass until nothing is pending. */
async function runSummarise() {
  const batch = Number(value('--batch', 5));
  const retryFailed = has('--retry-failed');
  let guard = 0;
  for (;;) {
    const result = await post('/api/releases/summarise', { limit: batch, retryFailed });
    console.log(
      `release-log: summarised ${result.summarised}/${result.processed} (failed ${result.failed}), ${result.remaining} remaining`,
    );
    if (!result.processed || result.remaining === 0) break;
    if (++guard > 500) {
      console.warn('release-log: summarise guard hit — stopping.');
      break;
    }
  }
}

async function main() {
  if (has('--backfill')) await runBackfill();
  else if (has('--summarise')) await runSummarise();
  else if (has('--head')) await runHead();
  else {
    console.error('release-log: nothing to do — pass --head, --backfill or --summarise.');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('release-log:', err.message);
  process.exit(1);
});
