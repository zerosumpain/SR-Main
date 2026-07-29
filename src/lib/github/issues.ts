/**
 * Minimal GitHub Issues client — the "footprint" half of the change-request
 * cycle: a request becomes an issue, the issue accumulates progress, and the
 * PR closes it. That makes the repo self-documenting: `git log` records what
 * changed, the linked issue records why it was asked for.
 *
 * Hard-scoped to one repo on purpose. The slug is a module constant rather than
 * a parameter so that no caller — and no LLM-authored tool argument — can point
 * this at another repository. Same reasoning as the Forge's git-target scope.
 *
 * Auth: `GITHUB_API_TOKEN` (preferred), `FORGE_GITHUB_TOKEN` (the name the
 * builder already uses for pushes/PRs), or `GITHUB_PAT`/`GITHUB_TOKEN`.
 * The last two matter: the production VPS container sets ONLY those, so before
 * they were accepted here every call in this module failed the configured check
 * and this whole path was silently dead in production (found 2026-07-29).
 * Everything degrades gracefully when unset — `githubConfigured()` is false and
 * callers surface a clear "not configured" result rather than throwing deep in
 * a tool call.
 */

/** The only repository this module will ever touch. */
export const REPO_SLUG = 'zerosumpain/SR-Main';

const API = 'https://api.github.com';

/** Shared by every GitHub client in the app — see also `$lib/github/pr`. */
export function githubToken(): string {
  return (
    process.env.GITHUB_API_TOKEN ||
    process.env.FORGE_GITHUB_TOKEN ||
    process.env.GITHUB_PAT ||
    process.env.GITHUB_TOKEN ||
    ''
  );
}

function token(): string {
  return githubToken();
}

/** True when a token is available, so callers can fail politely up front. */
export function githubConfigured(): boolean {
  return token().length > 0;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'jkai-change-request',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Never let a token reach a log line or a tool result. GitHub does not echo the
 * token back, but error bodies are pasted into build logs and chat, so scrub
 * anything token-shaped defensively.
 */
function redact(text: string): string {
  return text.replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '<redacted>');
}

async function gh<T>(path: string, init: RequestInit): Promise<T> {
  if (!githubConfigured()) {
    throw new Error(
      'GitHub is not configured: set GITHUB_API_TOKEN (fine-grained PAT scoped to ' +
        `${REPO_SLUG} with issues:write + pull_requests:write).`,
    );
  }
  const res = await fetch(`${API}${path}`, { ...init, headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(redact(`GitHub ${init.method ?? 'GET'} ${path} failed: ${res.status} ${body.slice(0, 400)}`));
  }
  return (await res.json()) as T;
}

export interface CreatedIssue {
  number: number;
  url: string;
}

/** Open an issue — the durable record of what was asked for, in the asker's words. */
export async function createIssue(args: {
  title: string;
  body: string;
  labels?: string[];
}): Promise<CreatedIssue> {
  const issue = await gh<{ number: number; html_url: string }>(`/repos/${REPO_SLUG}/issues`, {
    method: 'POST',
    body: JSON.stringify({
      title: args.title.slice(0, 250),
      body: args.body,
      labels: args.labels ?? [],
    }),
  });
  return { number: issue.number, url: issue.html_url };
}

/**
 * Append progress to an issue. Best-effort by design: a failure to comment must
 * never fail the build it is reporting on, so callers should catch. Returns
 * false instead of throwing when GitHub is simply not configured.
 */
export async function commentOnIssue(issueNumber: number, body: string): Promise<boolean> {
  if (!githubConfigured()) return false;
  await gh(`/repos/${REPO_SLUG}/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  return true;
}
