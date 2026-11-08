/**
 * The pull-request desk behind /releases/pulls: every open pull request across
 * the owner's repositories, the ones merged lately, and three owner actions —
 * merge, close, and revert (the rollback).
 *
 * Scope is the owner's own account and nothing else. A caller names a PR by
 * `owner/repo` + number, and `parseRepo` refuses any owner but `DESK_OWNER`,
 * so the site token cannot be pointed at somebody else's repository from here.
 *
 * Every action re-reads the pull request from GitHub before it acts and refuses
 * on what it finds, not on what the page showed:
 *   - merge: open, not a draft, head unchanged since the page was read (`sha`),
 *     no conflicts, checks green, and no release already WAITING on the base
 *     branch — on SR-Main a newer pending run evicts an older pending one, so a
 *     merge then would silently cancel the earlier deploy (merged ≠ deployed).
 *   - revert: GitHub's own `revertPullRequest`, which opens a new PR that undoes
 *     the merge. That PR runs the full checks and is merged here like any other,
 *     so going back to the previous behaviour takes the same release path as
 *     going forward. It undoes CODE only: a schema the original PR added stays,
 *     and the PR body says so when the original touched the schema.
 *
 * `GITHUB_DESK_API` overrides the API origin for the local preview's stub, so
 * a preview can exercise these paths without a token that reaches real repos.
 */
import { githubToken } from './issues';
import { redactGitHubSecrets } from './redact';

export const DESK_OWNER = 'zerosumpain';
const REPO = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const TIMEOUT_MS = 10_000;
/** A PR pushed this recently with no checks may simply not have registered
 *  them yet — "no checks reported" is not a pass. */
const NO_CHECKS_GRACE_MS = 10 * 60 * 1000;

type Fetcher = typeof fetch;

export type CheckState = 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' | null;

export interface DeskCheck {
  name: string;
  /** success / failure / pending / skipped / … — lower-cased, one vocabulary. */
  state: string;
  url: string | null;
}

export interface DeskPull {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string | null;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  branch: string;
  base: string;
  headSha: string;
  mergeCommit: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  checkState: CheckState;
  checks: DeskCheck[];
  body: string;
  files: Array<{ path: string; additions: number; deletions: number }>;
  /** Set on an older automated bump when a newer one for the same package is open. */
  supersededBy: number | null;
  /** For a merged PR: the open or merged PR that reverts it, if there is one. */
  revertedBy: { number: number; url: string; merged: boolean } | null;
  /** What merging this does, in one sentence. */
  consequence: string;
  touchesSchema: boolean;
}

export interface MergeVerdict {
  ready: boolean;
  /** Why not, in plain words. Empty when ready. */
  reason: string;
}

export interface PullDesk {
  open: DeskPull[];
  merged: DeskPull[];
  fetchedAt: string;
}

export type ActionResult =
  | { ok: true; message: string; url?: string; number?: number }
  | { ok: false; status: number; message: string };

function api(): string {
  return (process.env.GITHUB_DESK_API || 'https://api.github.com').replace(/\/+$/, '');
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'sr-releases-pull-desk',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** `owner/repo` for this owner only, or null. */
export function parseRepo(value: unknown): { owner: string; name: string; slug: string } | null {
  if (typeof value !== 'string') return null;
  const m = REPO.exec(value.trim());
  if (!m || m[1].toLowerCase() !== DESK_OWNER) return null;
  if (m[2] === '.' || m[2] === '..') return null;
  return { owner: m[1], name: m[2], slug: `${m[1]}/${m[2]}` };
}

/** What a merge sets in motion, per repository. Kept short: it is read in a confirm(). */
export function consequenceOf(repo: string, base: string): string {
  const name = repo.split('/')[1]?.toLowerCase();
  if (name === 'sr-main' && base === 'master') return 'Merging deploys to strangeramblings.com through CI.';
  if (name === 'sr-appleapp' && base === 'main')
    return 'Merging pushes the ad-hoc app to the family. Test this branch on TestFlight first.';
  return `Merging lands on ${base}; that repository's own CI decides what ships.`;
}

const SCHEMA_PATH = /(^|\/)(schema[^/]*\.ts|drizzle\/|migrations?\/)|\.sql$/i;
export function touchesSchema(paths: readonly string[]): boolean {
  return paths.some((p) => SCHEMA_PATH.test(p));
}

/** Older open automated bumps of the same package, keyed to the newest. */
export function markSuperseded(pulls: DeskPull[]): void {
  const BUMP = /^deps\/(.+)-v?\d+(?:\.\d+)*[\w.-]*$/;
  const newest = new Map<string, DeskPull>();
  for (const p of pulls) {
    const m = BUMP.exec(p.branch);
    if (!m) continue;
    const key = `${p.repo}#${m[1]}`;
    const cur = newest.get(key);
    if (!cur || p.number > cur.number) newest.set(key, p);
  }
  for (const p of pulls) {
    const m = BUMP.exec(p.branch);
    if (!m) continue;
    const top = newest.get(`${p.repo}#${m[1]}`);
    p.supersededBy = top && top.number !== p.number ? top.number : null;
  }
}

/** The page's view of whether Merge can be offered. The server re-checks on click. */
export function mergeVerdict(p: Pick<DeskPull, 'isDraft' | 'mergeable' | 'checkState' | 'updatedAt' | 'supersededBy'>, now = Date.now()): MergeVerdict {
  if (p.isDraft) return { ready: false, reason: 'Draft — mark it ready on GitHub first.' };
  if (p.supersededBy) return { ready: false, reason: `Superseded by #${p.supersededBy}.` };
  if (p.mergeable === 'CONFLICTING') return { ready: false, reason: 'Conflicts with its base branch.' };
  if (p.checkState === 'FAILURE' || p.checkState === 'ERROR') return { ready: false, reason: 'Checks failed.' };
  if (p.checkState === 'PENDING' || p.checkState === 'EXPECTED') return { ready: false, reason: 'Checks still running.' };
  if (p.checkState === null && now - Date.parse(p.updatedAt) < NO_CHECKS_GRACE_MS)
    return { ready: false, reason: 'No checks reported yet — they may not have started.' };
  if (p.mergeable === 'UNKNOWN') return { ready: false, reason: 'GitHub is still working out whether it merges cleanly.' };
  return { ready: true, reason: '' };
}

// ——— GraphQL ————————————————————————————————————————————————————————

const PR_FIELDS = `
  id number title url isDraft createdAt updatedAt mergedAt
  author { login }
  repository { nameWithOwner }
  headRefName headRefOid baseRefName
  headRepository { owner { login } }
  mergeCommit { oid }
  additions deletions changedFiles mergeable body
  files(first: 100) { nodes { path additions deletions } }
  commits(last: 1) { nodes { commit { statusCheckRollup {
    state
    contexts(first: 60) { nodes {
      __typename
      ... on CheckRun { name status conclusion detailsUrl }
      ... on StatusContext { context state targetUrl }
    } }
  } } } }
`;

const SEARCH_QUERY = `query($q: String!, $n: Int!) {
  search(query: $q, type: ISSUE, first: $n) { nodes { ... on PullRequest { ${PR_FIELDS} } } }
}`;

const ONE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { state ${PR_FIELDS} } }
}`;

const REVERT_MUTATION = `mutation($id: ID!, $title: String!, $body: String!) {
  revertPullRequest(input: { pullRequestId: $id, title: $title, body: $body }) {
    revertPullRequest { number url }
  }
}`;

interface RawPull {
  id: string;
  state?: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  headRepository: { owner: { login: string } } | null;
  mergeCommit: { oid: string } | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: DeskPull['mergeable'];
  body: string | null;
  files: { nodes: Array<{ path: string; additions: number; deletions: number }> } | null;
  commits: { nodes: Array<{ commit: { statusCheckRollup: null | {
    state: Exclude<CheckState, null>;
    contexts: { nodes: Array<Record<string, string | null>> };
  } } }> };
}

async function graphql<T>(query: string, variables: Record<string, unknown>, token: string, fetcher: Fetcher): Promise<T> {
  const res = await fetcher(`${api()}/graphql`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  // GraphQL answers 200 with `errors`; never read that as an empty list.
  if (body.errors?.length) throw new Error(redactGitHubSecrets(`GitHub: ${body.errors[0].message}`, token));
  if (!body.data) throw new Error('GitHub returned no data');
  return body.data;
}

function toDesk(raw: RawPull): DeskPull {
  const rollup = raw.commits?.nodes?.[0]?.commit?.statusCheckRollup ?? null;
  const checks: DeskCheck[] = (rollup?.contexts?.nodes ?? []).map((c) =>
    c.__typename === 'StatusContext'
      ? { name: c.context ?? 'status', state: String(c.state ?? 'pending').toLowerCase(), url: c.targetUrl ?? null }
      : {
          name: c.name ?? 'check',
          state: String(c.status === 'COMPLETED' ? (c.conclusion ?? 'neutral') : (c.status ?? 'pending')).toLowerCase(),
          url: c.detailsUrl ?? null,
        },
  );
  const files = raw.files?.nodes ?? [];
  const repo = raw.repository.nameWithOwner;
  return {
    id: raw.id,
    repo,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    author: raw.author?.login ?? null,
    isDraft: raw.isDraft,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    mergedAt: raw.mergedAt,
    branch: raw.headRefName,
    base: raw.baseRefName,
    headSha: raw.headRefOid,
    mergeCommit: raw.mergeCommit?.oid ?? null,
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles,
    mergeable: raw.mergeable,
    checkState: rollup?.state ?? null,
    checks,
    body: (raw.body ?? '').slice(0, 6000),
    files,
    supersededBy: null,
    revertedBy: null,
    consequence: consequenceOf(repo, raw.baseRefName),
    touchesSchema: touchesSchema(files.map((f) => f.path)),
  };
}

const revertTitle = (title: string) => `Revert "${title}"`;

/** Open PRs and recently merged ones across the owner's repositories. */
export async function loadPullDesk(fetcher: Fetcher = fetch): Promise<PullDesk> {
  const token = githubToken();
  if (!token) throw new Error('No GitHub token on this host.');
  type S = { search: { nodes: RawPull[] } };
  const [open, merged] = await Promise.all([
    graphql<S>(SEARCH_QUERY, { q: `is:pr is:open archived:false user:${DESK_OWNER} sort:created-desc`, n: 50 }, token, fetcher),
    graphql<S>(SEARCH_QUERY, { q: `is:pr is:merged user:${DESK_OWNER} sort:updated-desc`, n: 30 }, token, fetcher),
  ]);
  const openPulls = open.search.nodes.filter((n) => n && n.number).map(toDesk);
  const mergedPulls = merged.search.nodes
    .filter((n) => n && n.number && n.mergedAt)
    .map(toDesk)
    .sort((a, b) => Date.parse(b.mergedAt!) - Date.parse(a.mergedAt!))
    .slice(0, 20);
  markSuperseded(openPulls);

  // A revert PR is recognised by GitHub's own title shape, in the same repo.
  for (const m of mergedPulls) {
    const want = revertTitle(m.title);
    const hit =
      openPulls.find((p) => p.repo === m.repo && p.title === want) ??
      mergedPulls.find((p) => p.repo === m.repo && p.title === want);
    if (hit) m.revertedBy = { number: hit.number, url: hit.url, merged: !!hit.mergedAt };
  }
  return { open: openPulls, merged: mergedPulls, fetchedAt: new Date().toISOString() };
}

async function readOne(slug: { owner: string; name: string }, number: number, token: string, fetcher: Fetcher) {
  const data = await graphql<{ repository: { pullRequest: RawPull | null } | null }>(
    ONE_QUERY,
    { owner: slug.owner, name: slug.name, number },
    token,
    fetcher,
  );
  const raw = data.repository?.pullRequest ?? null;
  return raw ? { raw, pull: toDesk(raw) } : null;
}

async function rest(path: string, init: RequestInit, token: string, fetcher: Fetcher): Promise<Response> {
  return fetcher(`${api()}${path}`, { ...init, headers: headers(token), signal: AbortSignal.timeout(TIMEOUT_MS) });
}

async function refusal(res: Response, token: string, what: string): Promise<ActionResult> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  return {
    ok: false,
    status: 502,
    message: `GitHub refused the ${what} (${res.status}): ${redactGitHubSecrets(body.message ?? res.statusText, token)}`,
  };
}

interface Target {
  repo: unknown;
  number: unknown;
}

function target(input: Target): { slug: NonNullable<ReturnType<typeof parseRepo>>; number: number } | ActionResult {
  const slug = parseRepo(input.repo);
  if (!slug) return { ok: false, status: 400, message: `Only ${DESK_OWNER}'s repositories can be changed here.` };
  const number = typeof input.number === 'number' ? input.number : Number(input.number);
  if (!Number.isInteger(number) || number <= 0) return { ok: false, status: 400, message: 'A pull request number is required.' };
  return { slug, number };
}

/** Squash-merge, after re-reading the PR and the base branch's release queue. */
export async function mergePull(input: Target & { sha: unknown }, fetcher: Fetcher = fetch): Promise<ActionResult> {
  const t = target(input);
  if ('ok' in t) return t;
  const token = githubToken();
  if (!token) return { ok: false, status: 503, message: 'No GitHub token on this host, so nothing was merged.' };

  const found = await readOne(t.slug, t.number, token, fetcher);
  if (!found) return { ok: false, status: 404, message: `${t.slug.slug}#${t.number} was not found.` };
  const { raw, pull } = found;
  if (raw.state !== 'OPEN') return { ok: false, status: 409, message: `#${t.number} is ${String(raw.state).toLowerCase()}, not open.` };
  if (typeof input.sha !== 'string' || input.sha !== pull.headSha)
    return { ok: false, status: 409, message: `#${t.number} has new commits since this page loaded. Reload and look again.` };
  const verdict = mergeVerdict(pull);
  if (!verdict.ready) return { ok: false, status: 409, message: verdict.reason };

  // A run already WAITING on the base would be evicted by the run this merge
  // starts. A run in progress is fine: ours queues behind it.
  for (const status of ['queued', 'waiting', 'pending']) {
    const runs = await rest(
      `/repos/${t.slug.slug}/actions/runs?branch=${encodeURIComponent(pull.base)}&event=push&status=${status}&per_page=1`,
      { method: 'GET' },
      token,
      fetcher,
    );
    if (!runs.ok) continue; // a repo without Actions has no queue to protect
    const { total_count } = (await runs.json().catch(() => ({ total_count: 0 }))) as { total_count?: number };
    if ((total_count ?? 0) > 0)
      return {
        ok: false,
        status: 409,
        message: `A release of ${pull.base} is already waiting to run. Merging now would cancel it — try again once it has started.`,
      };
  }

  const merged = await rest(
    `/repos/${t.slug.slug}/pulls/${t.number}/merge`,
    { method: 'PUT', body: JSON.stringify({ merge_method: 'squash', sha: pull.headSha, commit_title: `${pull.title} (#${t.number})` }) },
    token,
    fetcher,
  );
  if (!merged.ok) return refusal(merged, token, 'merge');
  const { sha } = (await merged.json().catch(() => ({}))) as { sha?: string };

  // Tidy the branch, as `gh pr merge --delete-branch` would. Never fatal, and
  // never a branch living in someone else's fork.
  if (raw.headRepository?.owner.login.toLowerCase() === DESK_OWNER) {
    await rest(`/repos/${t.slug.slug}/git/refs/heads/${encodeURIComponent(pull.branch)}`, { method: 'DELETE' }, token, fetcher).catch(() => null);
  }
  return {
    ok: true,
    message: `Merged #${t.number}${sha ? ` as ${sha.slice(0, 8)}` : ''}. ${pull.consequence}`,
    url: pull.url,
    number: t.number,
  };
}

/** Close without merging (a superseded bump, an abandoned idea). */
export async function closePull(input: Target, fetcher: Fetcher = fetch): Promise<ActionResult> {
  const t = target(input);
  if ('ok' in t) return t;
  const token = githubToken();
  if (!token) return { ok: false, status: 503, message: 'No GitHub token on this host, so nothing was closed.' };
  const found = await readOne(t.slug, t.number, token, fetcher);
  if (!found) return { ok: false, status: 404, message: `${t.slug.slug}#${t.number} was not found.` };
  if (found.raw.state !== 'OPEN') return { ok: false, status: 409, message: `#${t.number} is not open.` };
  const res = await rest(`/repos/${t.slug.slug}/pulls/${t.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) }, token, fetcher);
  if (!res.ok) return refusal(res, token, 'close');
  return { ok: true, message: `Closed #${t.number}. Its branch is kept, so it can be reopened.`, url: found.pull.url, number: t.number };
}

/**
 * Roll a merged PR back: GitHub opens a PR that undoes it. Nothing ships until
 * that PR passes its checks and is merged — from this page, like any other.
 */
export async function revertPull(input: Target, fetcher: Fetcher = fetch): Promise<ActionResult> {
  const t = target(input);
  if ('ok' in t) return t;
  const token = githubToken();
  if (!token) return { ok: false, status: 503, message: 'No GitHub token on this host, so nothing was reverted.' };
  const found = await readOne(t.slug, t.number, token, fetcher);
  if (!found) return { ok: false, status: 404, message: `${t.slug.slug}#${t.number} was not found.` };
  const { raw, pull } = found;
  if (raw.state !== 'MERGED') return { ok: false, status: 409, message: `#${t.number} was never merged, so there is nothing to roll back.` };

  const schemaNote = pull.touchesSchema
    ? '\n\n**Schema:** the original change touched the database schema. Reverting the code does not undo a schema change that already reached production — read the diff before merging.'
    : '';
  const body =
    `Reverts #${t.number} (${pull.title}).\n\n` +
    `Opened from the pull-request desk on /releases/pulls to restore the behaviour before that merge. ` +
    `It runs the same checks as any change; merging it ships the rollback.${schemaNote}`;

  let created: { revertPullRequest: { revertPullRequest: { number: number; url: string } | null } };
  try {
    created = await graphql(REVERT_MUTATION, { id: pull.id, title: revertTitle(pull.title), body }, token, fetcher);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 502,
      message: `${message}. If later merges changed the same lines, GitHub cannot revert it automatically — do it by hand.`,
    };
  }
  const opened = created.revertPullRequest.revertPullRequest;
  if (!opened) return { ok: false, status: 502, message: 'GitHub accepted the revert but returned no pull request.' };
  return {
    ok: true,
    message: `Opened #${opened.number} to roll back #${t.number}. Merge it when its checks pass.${pull.touchesSchema ? ' It touched the schema — read it first.' : ''}`,
    url: opened.url,
    number: opened.number,
  };
}
