// src/lib/github/pr.ts
//
// Minimal branch + commit + draft-PR client, built on the GitHub REST API.
//
// Why REST rather than the existing `publishViaGit` in $lib/jkai/sandbox.ts:
// that path shells out to git/gh inside a sandbox container. The production web
// container has neither a git checkout nor the gh CLI (verified 2026-07-29), so
// the only way the nightly engine can open a PR from prod is over HTTPS.
//
// Scope is deliberately narrow: one hard-coded repo (same reasoning as
// issues.ts), commits only ever land on a NEW branch, and nothing here can
// merge. The engine proposes; the owner disposes.

import { REPO_SLUG, githubToken } from './issues';

const API = 'https://api.github.com';

export interface FileChange {
  /** Repo-relative path, e.g. `src/lib/foo/bar.ts`. */
  path: string;
  /** Full file contents (UTF-8). */
  content: string;
}

export interface OpenedPr {
  number: number;
  url: string;
  branch: string;
}

export function prConfigured(): boolean {
  return githubToken().length > 0;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${githubToken()}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'jkai-selfimprove',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function redact(text: string): string {
  return text.replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '<redacted>');
}

async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!prConfigured()) throw new Error('GitHub is not configured (no token in env)');
  const res = await fetch(`${API}${path}`, { ...init, headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(redact(`GitHub ${init.method ?? 'GET'} ${path} failed: ${res.status} ${body.slice(0, 400)}`));
  }
  return (await res.json()) as T;
}

/** Paths the engine may never write. Guards the deploy + secret surface. */
const PROTECTED_PATHS = [
  /^\.github\//,
  /^\.env/,
  /^scripts\/deploy/,
  /^docker/i,
  /^Caddyfile/i,
  /(^|\/)keys\.json$/,
  /(^|\/)package-lock\.json$/,
];

export function pathAllowed(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('..')) return false;
  return !PROTECTED_PATHS.some((re) => re.test(path));
}

/**
 * Create `branch` off the repo's default branch, commit `files` to it, and open
 * a DRAFT pull request. Never merges, never pushes to master.
 */
export async function openDraftPr(args: {
  branch: string;
  title: string;
  body: string;
  files: FileChange[];
  commitMessage: string;
}): Promise<OpenedPr> {
  const rejected = args.files.filter((f) => !pathAllowed(f.path));
  if (rejected.length) {
    throw new Error(`refusing to write protected path(s): ${rejected.map((f) => f.path).join(', ')}`);
  }
  if (args.files.length === 0) throw new Error('no files to commit');

  const repo = await gh<{ default_branch: string }>(`/repos/${REPO_SLUG}`);
  const base = repo.default_branch;

  const baseRef = await gh<{ object: { sha: string } }>(`/repos/${REPO_SLUG}/git/ref/heads/${base}`);
  const baseSha = baseRef.object.sha;
  const baseCommit = await gh<{ tree: { sha: string } }>(`/repos/${REPO_SLUG}/git/commits/${baseSha}`);

  // Blobs → tree → commit → branch ref. Doing it this way (rather than the
  // contents API) keeps a multi-file change in ONE commit.
  const tree = await Promise.all(
    args.files.map(async (f) => {
      const blob = await gh<{ sha: string }>(`/repos/${REPO_SLUG}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: f.content, encoding: 'utf-8' }),
      });
      return { path: f.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha };
    }),
  );

  const newTree = await gh<{ sha: string }>(`/repos/${REPO_SLUG}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
  });

  const commit = await gh<{ sha: string }>(`/repos/${REPO_SLUG}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: args.commitMessage,
      tree: newTree.sha,
      parents: [baseSha],
    }),
  });

  await gh(`/repos/${REPO_SLUG}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${args.branch}`, sha: commit.sha }),
  });

  const pr = await gh<{ number: number; html_url: string }>(`/repos/${REPO_SLUG}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: args.title.slice(0, 250),
      body: args.body,
      head: args.branch,
      base,
      draft: true,
    }),
  });

  return { number: pr.number, url: pr.html_url, branch: args.branch };
}
