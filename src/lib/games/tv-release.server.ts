// The sr. tv app's latest release, for the TV's self-update and the install
// link. The APK is built by the public zerosumpain/SR-TV repo's CI and
// published as a GitHub release asset; tags are `v1.0.<versionCode>`.
// Read from GitHub's API and kept ten minutes, so a TV starting up never
// waits on it twice.

export const SR_TV_REPO = 'zerosumpain/SR-TV';
export const APK_URL = `https://github.com/${SR_TV_REPO}/releases/latest/download/sr-tv.apk`;
const TTL_MS = 10 * 60_000;

export interface TvRelease {
  versionCode: number;
  versionName: string;
  url: string;
  publishedAt: string | null;
}

let cache: { at: number; release: TvRelease | null } | null = null;

/** The newest release, or null when GitHub cannot say (the caller answers 503). */
export async function latestTvRelease(fetcher: typeof fetch = fetch, now = Date.now()): Promise<TvRelease | null> {
  if (cache && now - cache.at < TTL_MS) return cache.release;
  let release: TvRelease | null = null;
  try {
    const res = await fetcher(`https://api.github.com/repos/${SR_TV_REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'strangeramblings-sr-tv' },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const body = (await res.json()) as { tag_name?: string; published_at?: string; assets?: { name?: string; browser_download_url?: string }[] };
      const m = /^v(\d+)\.(\d+)\.(\d+)$/u.exec(body.tag_name ?? '');
      const asset = body.assets?.find((a) => a.name === 'sr-tv.apk');
      if (m && asset?.browser_download_url) {
        release = { versionCode: Number(m[3]), versionName: `${m[1]}.${m[2]}.${m[3]}`, url: asset.browser_download_url, publishedAt: body.published_at ?? null };
      }
    }
  } catch {
    release = null;
  }
  // A failure is kept a minute, not ten, so the next TV tries again soon.
  cache = { at: release ? now : now - TTL_MS + 60_000, release };
  return release;
}

/** Tests only. */
export function _resetTvRelease(): void {
  cache = null;
}
