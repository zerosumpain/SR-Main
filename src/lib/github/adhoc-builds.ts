import { githubToken } from './issues';
import { redactGitHubSecrets } from './redact';

/**
 * The ad-hoc copy of the iPhone app, as GitHub holds it — see $lib/server/adhoc-install
 * for why it exists.
 *
 * SR-AppleApp's `testflight.yml` exports an ad-hoc IPA beside every TestFlight
 * upload from `main` and keeps the newest few as draft releases (tag
 * `adhoc-<run>`), so the owner can choose which one the family's phones get
 * (`$lib/server/app-release`) and roll back. A draft, because the repo
 * is public and the IPA carries the UDIDs it installs on: a draft is visible
 * only to accounts that can push. So the app is fetched here with the site's
 * GitHub token and streamed on to the phone; it never has a public URL.
 *
 * Hard-scoped to one repository and one workflow, like `$lib/github/issues`:
 * the slug is a constant, so nothing a caller passes can aim this elsewhere.
 */

export const APP_REPO = 'zerosumpain/SR-AppleApp';
const WORKFLOW = 'testflight.yml';
/** The drafts' title; each is tagged `adhoc-<run number>`. */
export const ADHOC_RELEASE_NAME = 'Ad-hoc build';
const API = 'https://api.github.com';

export type AdhocBuild = {
  bundleId: string;
  version: string;
  build: string;
  commit: string | null;
  builtAt: string | null;
  /** The names of the phones this copy installs on, as the developer account lists them. */
  devices: string[];
  ipaAssetId: number;
  ipaBytes: number;
};

export class AdhocUnavailable extends Error {}

function headers(accept = 'application/vnd.github+json'): Record<string, string> {
  return {
    Authorization: `Bearer ${githubToken()}`,
    Accept: accept,
    'User-Agent': 'sr-adhoc-install',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function gh(path: string, init: RequestInit = {}, accept?: string): Promise<Response> {
  if (!githubToken()) throw new AdhocUnavailable('GitHub is not configured on this host (GITHUB_API_TOKEN).');
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers(accept), ...(init.headers ?? {}) } });
  if (!res.ok) {
    const body = redactGitHubSecrets((await res.text().catch(() => '')).slice(0, 300));
    throw new AdhocUnavailable(`GitHub answered ${res.status} for ${path}: ${body}`);
  }
  return res;
}

type Asset = { id: number; name: string; size: number };
type Release = {
  id: number;
  name: string | null;
  draft: boolean;
  tag_name?: string;
  target_commitish?: string;
  created_at?: string;
  assets: Asset[];
};

/** One ad-hoc copy as GitHub lists it, before its build.json is read. */
export type AdhocDraft = {
  /** The `testflight.yml` run number — the app's build number. */
  run: number;
  /** The commit it was built from (`--target $GITHUB_SHA`). */
  commit: string | null;
  createdAt: string | null;
  ipa: Asset;
  meta: Asset;
};

/** `adhoc-133` → 133. PURE. */
export function runOfTag(tag: string | undefined): number | null {
  const m = /^adhoc-(\d+)$/.exec(tag ?? '');
  return m ? Number(m[1]) : null;
}

/** The ad-hoc drafts among a page of releases, newest build first. PURE. */
export function adhocDrafts(releases: readonly Release[]): AdhocDraft[] {
  const out: AdhocDraft[] = [];
  for (const r of releases) {
    if (!r.draft || r.name !== ADHOC_RELEASE_NAME) continue;
    const run = runOfTag(r.tag_name);
    const ipa = r.assets.find((a) => a.name.endsWith('.ipa'));
    const meta = r.assets.find((a) => a.name === 'build.json');
    if (run === null || !ipa || !meta) continue;
    const commit = r.target_commitish && /^[0-9a-f]{40}$/.test(r.target_commitish) ? r.target_commitish : null;
    out.push({ run, commit, createdAt: r.created_at ?? null, ipa, meta });
  }
  return out.sort((a, b) => b.run - a.run);
}

let listed: { at: number; drafts: AdhocDraft[] } | null = null;
const CACHE_MS = 60_000;
/** A build's build.json never changes once published: kept by run. */
const metaByRun = new Map<number, AdhocBuild | null>();

/** Every ad-hoc copy GitHub still holds, newest first. `fresh` skips the minute's cache. */
export async function listAdhocDrafts(fresh = false, nowMs = Date.now()): Promise<AdhocDraft[]> {
  if (!fresh && listed && nowMs - listed.at < CACHE_MS) return listed.drafts;
  const releases = (await (await gh(`/repos/${APP_REPO}/releases?per_page=50`)).json()) as Release[];
  const drafts = adhocDrafts(releases);
  listed = { at: nowMs, drafts };
  return drafts;
}

/** A draft with its build.json read: what the phones and the install page need. */
export async function adhocBuildOf(draft: AdhocDraft): Promise<AdhocBuild | null> {
  if (metaByRun.has(draft.run)) return metaByRun.get(draft.run) ?? null;
  const info = (await (await gh(`/repos/${APP_REPO}/releases/assets/${draft.meta.id}`, {}, 'application/octet-stream')).json()) as Record<
    string,
    unknown
  >;
  let build: AdhocBuild | null = null;
  if (typeof info.bundleId === 'string' && typeof info.version === 'string') {
    build = {
      bundleId: info.bundleId,
      version: info.version,
      build: String(info.build ?? draft.run),
      commit: typeof info.commit === 'string' ? info.commit : draft.commit,
      builtAt: typeof info.builtAt === 'string' ? info.builtAt : draft.createdAt,
      devices: Array.isArray(info.devices) ? info.devices.filter((d): d is string => typeof d === 'string') : [],
      ipaAssetId: draft.ipa.id,
      ipaBytes: draft.ipa.size,
    };
  }
  metaByRun.set(draft.run, build);
  return build;
}

/**
 * The newest ad-hoc copy, or null when none has been built yet. NOT what the
 * family are offered — that is `releasedAdhocBuild` in `$lib/server/app-release`.
 */
export async function latestAdhocBuild(): Promise<AdhocBuild | null> {
  const [newest] = await listAdhocDrafts();
  return newest ? adhocBuildOf(newest) : null;
}

/** For tests: forget what was read. */
export function resetAdhocCache(): void {
  listed = null;
  metaByRun.clear();
}

/** The IPA's bytes, streamed from GitHub (which redirects to a signed download). */
export async function adhocIpa(build: AdhocBuild): Promise<Response> {
  return gh(`/repos/${APP_REPO}/releases/assets/${build.ipaAssetId}`, {}, 'application/octet-stream');
}

export type LatestAppBuild = { build: number; commit: string; at: string | null };

/**
 * The newest build of the app that finished, whichever channel it went to:
 * every copy's build number is the `testflight.yml` run number, so the last
 * successful run on `main` IS the latest build. What the fleet view measures
 * each phone's build against, and what the app's update prompt offers.
 *
 * `main` only: the owner tries a branch on TestFlight before the family get
 * it (2026-10-21), and that run must not tell every ad-hoc phone a new
 * version is ready — the ad-hoc copy is never published from a branch.
 */
export async function latestAppBuild(): Promise<LatestAppBuild | null> {
  const res = await gh(`/repos/${APP_REPO}/actions/workflows/${WORKFLOW}/runs?status=success&branch=main&per_page=1`);
  const body = (await res.json()) as { workflow_runs?: Array<{ run_number?: number; head_sha?: string; updated_at?: string }> };
  const run = body.workflow_runs?.[0];
  if (!run || typeof run.run_number !== 'number' || typeof run.head_sha !== 'string') return null;
  return { build: run.run_number, commit: run.head_sha, at: typeof run.updated_at === 'string' ? run.updated_at : null };
}

/**
 * The newest build uploaded to TestFlight from ANY branch — what the owner's
 * own TestFlight copy is testing, which may be ahead of `main`.
 */
export async function latestTestFlightRun(): Promise<(LatestAppBuild & { branch: string | null }) | null> {
  const res = await gh(`/repos/${APP_REPO}/actions/workflows/${WORKFLOW}/runs?status=success&per_page=1`);
  const body = (await res.json()) as {
    workflow_runs?: Array<{ run_number?: number; head_sha?: string; updated_at?: string; head_branch?: string }>;
  };
  const run = body.workflow_runs?.[0];
  if (!run || typeof run.run_number !== 'number' || typeof run.head_sha !== 'string') return null;
  return {
    build: run.run_number,
    commit: run.head_sha,
    at: typeof run.updated_at === 'string' ? run.updated_at : null,
    branch: typeof run.head_branch === 'string' ? run.head_branch : null,
  };
}

/** Whether a TestFlight / ad-hoc build is queued or running now. */
export async function adhocBuildRunning(): Promise<boolean> {
  for (const status of ['in_progress', 'queued']) {
    const res = await gh(`/repos/${APP_REPO}/actions/workflows/${WORKFLOW}/runs?status=${status}&per_page=1`);
    const body = (await res.json()) as { total_count?: number };
    if ((body.total_count ?? 0) > 0) return true;
  }
  return false;
}

/**
 * Build a fresh ad-hoc copy, without a TestFlight upload. With a UDID, the
 * phone is registered with Apple first, so the copy installs on it. The UDID
 * travels as a workflow input, which GitHub does not show on a public run;
 * the workflow masks it in its logs.
 */
export async function startAdhocBuild(device?: { udid: string; name: string }): Promise<void> {
  const inputs: Record<string, string> = { testflight: 'false' };
  if (device) {
    inputs.adhoc_udid = device.udid;
    inputs.adhoc_name = device.name;
  }
  await gh(`/repos/${APP_REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs }),
  });
  listed = null;
}
