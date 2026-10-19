import { githubToken } from './issues';
import { redactGitHubSecrets } from './redact';

/**
 * The ad-hoc copy of the iPhone app, as GitHub holds it — see $lib/server/adhoc-install
 * for why it exists.
 *
 * SR-AppleApp's `testflight.yml` exports an ad-hoc IPA beside every TestFlight
 * upload and keeps the newest in ONE draft release. A draft, because the repo
 * is public and the IPA carries the UDIDs it installs on: a draft is visible
 * only to accounts that can push. So the app is fetched here with the site's
 * GitHub token and streamed on to the phone; it never has a public URL.
 *
 * Hard-scoped to one repository and one workflow, like `$lib/github/issues`:
 * the slug is a constant, so nothing a caller passes can aim this elsewhere.
 */

export const APP_REPO = 'zerosumpain/SR-AppleApp';
const WORKFLOW = 'testflight.yml';
/** The draft's title, which `testflight.yml` replaces each time. */
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
type Release = { id: number; name: string | null; draft: boolean; assets: Asset[] };

let cached: { at: number; build: AdhocBuild | null } | null = null;
const CACHE_MS = 60_000;

/** The newest ad-hoc copy, or null when none has been built yet. */
export async function latestAdhocBuild(nowMs = Date.now()): Promise<AdhocBuild | null> {
  if (cached && nowMs - cached.at < CACHE_MS) return cached.build;
  const releases = (await (await gh(`/repos/${APP_REPO}/releases?per_page=30`)).json()) as Release[];
  const draft = releases.find((r) => r.draft && r.name === ADHOC_RELEASE_NAME);
  const ipa = draft?.assets.find((a) => a.name.endsWith('.ipa'));
  const meta = draft?.assets.find((a) => a.name === 'build.json');
  let build: AdhocBuild | null = null;
  if (ipa && meta) {
    const info = (await (await gh(`/repos/${APP_REPO}/releases/assets/${meta.id}`, {}, 'application/octet-stream')).json()) as Record<
      string,
      unknown
    >;
    if (typeof info.bundleId === 'string' && typeof info.version === 'string') {
      build = {
        bundleId: info.bundleId,
        version: info.version,
        build: String(info.build ?? ''),
        commit: typeof info.commit === 'string' ? info.commit : null,
        builtAt: typeof info.builtAt === 'string' ? info.builtAt : null,
        devices: Array.isArray(info.devices) ? info.devices.filter((d): d is string => typeof d === 'string') : [],
        ipaAssetId: ipa.id,
        ipaBytes: ipa.size,
      };
    }
  }
  cached = { at: nowMs, build };
  return build;
}

/** The IPA's bytes, streamed from GitHub (which redirects to a signed download). */
export async function adhocIpa(build: AdhocBuild): Promise<Response> {
  return gh(`/repos/${APP_REPO}/releases/assets/${build.ipaAssetId}`, {}, 'application/octet-stream');
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
  cached = null;
}
