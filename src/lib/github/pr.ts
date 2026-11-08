// src/lib/github/pr.ts
//
// Minimal pull-request client, built on the GitHub REST API. Nothing here can
// merge. (The nightly engine's blind `openDraftPr` lived here until
// 2026-10-02, when backlog work moved to development deliveries.)
//
// `openPullRequest` is the one PR opener for the whole app: the jkai lanes
// (Forge `publishViaGit`, develop release) push their branch with git and then
// call it with their own repo and token.

import { REPO_SLUG, githubToken } from './issues';
import { redactGitHubSecrets } from './redact';

const API = 'https://api.github.com';

/** Pull the PR number out of a `published_slug`, which holds a PR url on a
 *  git-target build and a branch ref or a project slug otherwise. Returns null
 *  for anything that is not a pull-request url on this repo. */
export function prNumberFromUrl(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const m = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i.exec(value.trim());
  if (!m || m[1].toLowerCase() !== REPO_SLUG.toLowerCase()) return null;
  return Number(m[2]);
}

/** Every repo-relative path a PR touches. Paginated: GitHub caps this at 100
 *  per page and a change request can exceed that, and a truncated list would
 *  silently fail to find a page the PR really did add. */
export async function listPrFiles(prNumber: number): Promise<string[]> {
  const paths: string[] = [];
  for (let page = 1; page <= 30; page++) {
    const res = await fetch(
      `${API}/repos/${REPO_SLUG}/pulls/${prNumber}/files?per_page=100&page=${page}`,
      { headers: headers() },
    );
    if (!res.ok) throw new Error(`GitHub ${res.status} ${res.statusText}`);
    const batch = (await res.json()) as Array<{ filename?: string }>;
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const f of batch) if (typeof f.filename === 'string') paths.push(f.filename);
    if (batch.length < 100) break;
  }
  return paths;
}

function headers(token: string = githubToken(), userAgent = 'jkai-selfimprove'): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': userAgent,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** Derive an `owner/repo` slug from an SSH or HTTPS git URL. */
export function repoSlugFromUrl(repoUrl: string): string {
  // git@github.com:owner/repo.git  |  https://github.com/owner/repo.git
  const m = repoUrl.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return m ? m[1] : repoUrl;
}

export interface OpenPullRequestArgs {
  /** `owner/repo`. Defaults to this site's repo. */
  repo?: string;
  /** Branch that already exists on the remote. */
  head: string;
  base: string;
  title: string;
  body: string;
  draft?: boolean;
  /** Defaults to `githubToken()`. The jkai lanes pass FORGE_GITHUB_TOKEN. */
  token?: string;
  /** Distinguishes the callers in GitHub's audit log. */
  userAgent?: string;
}

export interface PullRequestRef {
  number: number;
  url: string;
  /** True when GitHub said one already existed for this head and we reused it. */
  reused: boolean;
}

/**
 * Open a pull request for a branch that is already pushed — the ONE
 * implementation every lane uses (selfimprove via `openDraftPr`, the Forge's
 * `publishViaGit`, and the develop lane's release).
 *
 * Runs Node-side over `fetch`, so the token never touches a command line.
 * Idempotent: a 422 for a head that already has an open pull request against
 * `base` returns that pull request (`reused: true`) instead of failing, so a
 * re-run after a crash between push and PR does not need a person. Never merges.
 */
export async function openPullRequest(args: OpenPullRequestArgs): Promise<PullRequestRef> {
  const repo = args.repo ?? REPO_SLUG;
  const token = args.token ?? githubToken();
  if (!token) throw new Error('GitHub is not configured (no token in env)');
  const h = headers(token, args.userAgent);

  const created = await fetch(`${API}/repos/${repo}/pulls`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      title: args.title.slice(0, 250),
      head: args.head,
      base: args.base,
      body: args.body,
      draft: args.draft === true,
    }),
  });

  if (created.ok) {
    const json = (await created.json().catch(() => ({}))) as { html_url?: unknown; number?: unknown };
    if (typeof json.html_url === 'string' && typeof json.number === 'number') {
      return { number: json.number, url: json.html_url, reused: false };
    }
    throw new Error('GitHub accepted the pull request but returned no url.');
  }

  const text = await created.text().catch(() => '');
  if (created.status === 422) {
    // GitHub's `head` filter wants `owner:branch`.
    const owner = repo.split('/')[0];
    const listUrl =
      `${API}/repos/${repo}/pulls` +
      `?head=${encodeURIComponent(`${owner}:${args.head}`)}&base=${encodeURIComponent(args.base)}&state=open`;
    const existing = await fetch(listUrl, { headers: h }).catch(() => null);
    if (existing?.ok) {
      const list = (await existing.json().catch(() => [])) as Array<{ html_url?: unknown; number?: unknown }>;
      const match = Array.isArray(list)
        ? list.find((p) => typeof p.html_url === 'string' && typeof p.number === 'number')
        : undefined;
      if (match) return { number: match.number as number, url: match.html_url as string, reused: true };
    }
  }
  throw new Error(redactGitHubSecrets(`GitHub refused the pull request (${created.status}): ${text.slice(0, 1000)}`, token));
}

/**
 * Close a pull request, leaving a comment that says why. The one closer, beside
 * the one opener, so a lane retiring its own proposal never needs a second
 * GitHub client. Never deletes the branch: the commit stays reviewable.
 */
export async function closePullRequest(args: { repo?: string; number: number; comment?: string; token?: string; userAgent?: string }): Promise<void> {
  const repo = args.repo ?? REPO_SLUG;
  const token = args.token ?? githubToken();
  if (!token) throw new Error('GitHub is not configured (no token in env)');
  const h = headers(token, args.userAgent);
  if (args.comment) {
    await fetch(`${API}/repos/${repo}/issues/${args.number}/comments`, { method: 'POST', headers: h, body: JSON.stringify({ body: args.comment.slice(0, 4000) }) }).catch(() => null);
  }
  const res = await fetch(`${API}/repos/${repo}/pulls/${args.number}`, { method: 'PATCH', headers: h, body: JSON.stringify({ state: 'closed' }) });
  if (!res.ok) throw new Error(redactGitHubSecrets(`GitHub refused to close #${args.number} (${res.status}): ${(await res.text().catch(() => '')).slice(0, 500)}`, token));
}
