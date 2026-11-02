import { afterEach, describe, expect, it } from 'vitest';
import { _resetTvRelease, latestTvRelease } from './tv-release.server';

const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

afterEach(() => _resetTvRelease());

describe('the latest sr. tv release', () => {
  it('reads the version code from the tag and the APK asset', async () => {
    const r = await latestTvRelease(ok({ tag_name: 'v1.0.7', assets: [{ name: 'sr-tv.apk', browser_download_url: 'https://example.test/sr-tv.apk' }] }));
    expect(r).toEqual({ versionCode: 7, versionName: '1.0.7', url: 'https://example.test/sr-tv.apk', publishedAt: null });
  });
  it('is null without the APK, or when GitHub fails', async () => {
    expect(await latestTvRelease(ok({ tag_name: 'v1.0.7', assets: [] }))).toBeNull();
    _resetTvRelease();
    expect(await latestTvRelease((async () => new Response('', { status: 500 })) as unknown as typeof fetch)).toBeNull();
  });
});
