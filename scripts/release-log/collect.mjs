// Release-log collector — turns git history into release payloads.
//
// Two callers:
//   ci-deploy.sh  → collectRelease(prevDeployedSha, HEAD): the exact range that
//                   just went live. This is the accurate path.
//   --backfill    → reconstructs the era before the releases table existed.
//                   Git records commits, not pushes, so boundaries are inferred:
//                     * a PR squash-merge `(#123)` or a merge commit is its own
//                       release (post-CI era: one merge == one deploy), and
//                     * runs of ordinary commits are clustered by time gap
//                       (pre-CI era: a manual deploy.sh run shipped whatever had
//                       accumulated in that sitting).
//                   Reconstructed rows are marked via='backfill' so the UI can
//                   say the timestamps are approximate.
//
// No dependencies, no side effects on import — the pure helpers are unit-tested
// from tests/lib/releases/collect.test.ts.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// The repo type-checks JS (`checkJs`), and tests/lib/releases/collect.test.ts
// imports this module — so the shapes below are checked, not decorative.
/**
 * @typedef {{ sha: string, short: string, ts: number, parents: string[], subject: string, pr: number|null }} FirstParentCommit
 * @typedef {{ sha: string, short: string, author: string, date: string, subject: string, body: string, pr: number|null }} CommitFact
 * @typedef {{ path: string, status: string, insertions: number, deletions: number }} FileFact
 * @typedef {{ commits: number, files: number, insertions: number, deletions: number, prs: number[] }} ReleaseStats
 * @typedef {{ sha: string, shortSha: string, prevSha: string|null, branch: string, via: string,
 *             deployedAt: string, builtAt: string|null, commits: CommitFact[], files: FileFact[],
 *             stats: ReleaseStats, contentHash: string }} ReleasePayload
 * @typedef {{ branch?: string, via?: string, deployedAt?: string|null, builtAt?: string|null, gapSeconds?: number }} CollectOptions
 */

/** git's canonical empty tree — the "parent" of the very first commit. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const UNIT = '\x1f'; // field separator
const RECORD = '\x1e'; // record separator

/** Payload caps. Stats always reflect the true totals; only the detail is trimmed. */
export const MAX_COMMITS = 200;
export const MAX_FILES = 400;

/** Default clustering gap for the backfill: commits more than 45 minutes apart
 *  were almost certainly separate sittings, and so separate deploys. */
export const DEFAULT_GAP_SECONDS = 45 * 60;

/**
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {string}
 */
export function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
}

/**
 * `feat(x): thing (#123)` → 123. Also handles merge-commit subjects.
 * @param {string} subject
 * @returns {number|null}
 */
export function parsePrNumber(subject) {
  const squash = /\(#(\d+)\)\s*$/.exec(subject || '');
  if (squash) return Number(squash[1]);
  const merge = /^Merge pull request #(\d+)\b/.exec(subject || '');
  if (merge) return Number(merge[1]);
  return null;
}

/**
 * A commit that ended a push in its own right: a PR landing on master. In the
 * CI era every one of these triggered exactly one deploy, so it must never be
 * clustered together with its neighbours.
 * @param {FirstParentCommit} commit
 * @returns {boolean}
 */
export function isReleaseBoundary(commit) {
  return commit.pr !== null || commit.parents.length > 1;
}

/**
 * Group first-parent commits (ordered OLDEST → NEWEST) into releases.
 * Pure — the unit under test.
 * @param {FirstParentCommit[]} commits
 * @param {number} [gapSeconds]
 * @returns {FirstParentCommit[][]}
 */
export function clusterCommits(commits, gapSeconds = DEFAULT_GAP_SECONDS) {
  /** @type {FirstParentCommit[][]} */
  const clusters = [];
  /** @type {FirstParentCommit[]|null} */
  let current = null;
  /** @type {FirstParentCommit|null} */
  let previous = null;

  for (const c of commits) {
    const startNew =
      current === null ||
      previous === null ||
      isReleaseBoundary(c) || // a PR merge is always its own release
      isReleaseBoundary(previous) || // …and never absorbs what follows it
      c.ts - previous.ts > gapSeconds;
    if (startNew || current === null) {
      /** @type {FirstParentCommit[]} */
      const fresh = [];
      clusters.push(fresh);
      current = fresh;
    }
    current.push(c);
    previous = c;
  }
  return clusters;
}

/**
 * First-parent history of `ref`, OLDEST → NEWEST.
 * @param {string} ref
 * @param {string} [cwd]
 * @returns {FirstParentCommit[]}
 */
export function firstParentCommits(ref, cwd) {
  const out = git(
    ['log', '--first-parent', '--reverse', `--format=%H${UNIT}%ct${UNIT}%P${UNIT}%s${RECORD}`, ref],
    cwd,
  );
  return out
    .split(RECORD)
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim())
    .map((record) => {
      const [sha, ts, parents, subject = ''] = record.split(UNIT);
      return {
        sha,
        short: sha.slice(0, 8),
        ts: Number(ts),
        parents: parents.trim() ? parents.trim().split(' ') : [],
        subject,
        pr: parsePrNumber(subject),
      };
    });
}

/**
 * Every commit in `prev..head` (including merged-in side branches), newest first.
 * @param {string|null} prevSha
 * @param {string} headSha
 * @param {string} [cwd]
 * @returns {CommitFact[]}
 */
export function commitsInRange(prevSha, headSha, cwd) {
  const range = prevSha ? `${prevSha}..${headSha}` : headSha;
  const out = git(
    ['log', `--format=%H${UNIT}%h${UNIT}%an${UNIT}%aI${UNIT}%s${UNIT}%b${RECORD}`, range],
    cwd,
  );
  return out
    .split(RECORD)
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim())
    .map((record) => {
      const [sha, short, author, date, subject = '', body = ''] = record.split(UNIT);
      return {
        sha,
        short: short || sha.slice(0, 8),
        author,
        date,
        subject,
        body: body.trim(),
        pr: parsePrNumber(subject),
      };
    });
}

/**
 * Parse `git diff --numstat` output. Binary files report `-` for both counts.
 * @param {string} text
 * @returns {FileFact[]}
 */
export function parseNumstat(text) {
  /** @type {FileFact[]} */
  const files = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const [ins, del, ...rest] = line.split('\t');
    const path = rest.join('\t');
    if (!path) continue;
    files.push({
      path,
      status: 'M',
      insertions: ins === '-' ? 0 : Number(ins) || 0,
      deletions: del === '-' ? 0 : Number(del) || 0,
    });
  }
  return files;
}

/**
 * Parse `git diff --name-status` into path → status letter.
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseNameStatus(text) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const [status, ...rest] = line.split('\t');
    const path = rest.join('\t');
    if (path) map.set(path, status.slice(0, 4));
  }
  return map;
}

/**
 * @param {string|null} prevSha
 * @param {string} headSha
 * @param {string} [cwd]
 * @returns {FileFact[]}
 */
export function diffFiles(prevSha, headSha, cwd) {
  const base = prevSha || EMPTY_TREE;
  const files = parseNumstat(git(['diff', '--numstat', base, headSha], cwd));
  const statuses = parseNameStatus(git(['diff', '--name-status', base, headSha], cwd));
  for (const f of files) f.status = statuses.get(f.path) ?? 'M';
  return files;
}

/**
 * Stable hash of the git facts, so a re-ingest of identical content is a no-op.
 * @param {{sha: string}[]} commits
 * @param {{path: string, insertions: number, deletions: number}[]} files
 * @returns {string}
 */
export function contentHash(commits, files) {
  const h = createHash('sha256');
  for (const c of commits) h.update(c.sha);
  for (const f of files) h.update(`${f.path}:${f.insertions}:${f.deletions}`);
  return h.digest('hex');
}

/**
 * Build the /api/releases/ingest payload for the range `prevSha..headSha`.
 * `deployedAt` defaults to the head commit's date, which is right for the
 * backfill; the CI hook passes the actual deploy time.
 * @param {string|null} prevSha
 * @param {string} headSha
 * @param {string} [cwd]
 * @param {CollectOptions} [opts]
 * @returns {ReleasePayload}
 */
export function collectRelease(prevSha, headSha, cwd, opts = {}) {
  const allCommits = commitsInRange(prevSha, headSha, cwd);
  const allFiles = diffFiles(prevSha, headSha, cwd);

  const stats = {
    commits: allCommits.length,
    files: allFiles.length,
    insertions: allFiles.reduce((n, f) => n + f.insertions, 0),
    deletions: allFiles.reduce((n, f) => n + f.deletions, 0),
    prs: [...new Set(allCommits.map((c) => c.pr).filter((n) => n !== null))],
  };

  // Trim the detail (not the stats) for outsized ranges — a 900-file refactor
  // would otherwise put a megabyte of paths in a jsonb column for no gain.
  const commits = allCommits.slice(0, MAX_COMMITS);
  const files = [...allFiles]
    .sort((a, b) => b.insertions + b.deletions - (a.insertions + a.deletions))
    .slice(0, MAX_FILES);

  const headDate = allCommits[0]?.date ?? new Date().toISOString();
  return {
    sha: headSha,
    shortSha: headSha.slice(0, 8),
    prevSha: prevSha || null,
    branch: opts.branch || 'master',
    via: opts.via || 'backfill',
    deployedAt: opts.deployedAt || headDate,
    builtAt: opts.builtAt || null,
    commits,
    files,
    stats,
    contentHash: contentHash(allCommits, allFiles),
  };
}

/**
 * Reconstruct every historical release on `ref`, OLDEST → NEWEST.
 * Returns payloads ready to POST.
 * @param {string} ref
 * @param {string} [cwd]
 * @param {CollectOptions} [opts]
 * @returns {ReleasePayload[]}
 */
export function collectHistory(ref, cwd, opts = {}) {
  const gap = opts.gapSeconds ?? DEFAULT_GAP_SECONDS;
  const clusters = clusterCommits(firstParentCommits(ref, cwd), gap);
  /** @type {ReleasePayload[]} */
  const payloads = [];
  for (const cluster of clusters) {
    const head = cluster[cluster.length - 1];
    const oldest = cluster[0];
    // The commit this cluster replaced: the first parent of its oldest commit.
    const prevSha = oldest.parents[0] ?? null;
    payloads.push(
      collectRelease(prevSha, head.sha, cwd, {
        via: 'backfill',
        branch: opts.branch || 'master',
        deployedAt: new Date(head.ts * 1000).toISOString(),
      }),
    );
  }
  return payloads;
}
