import { describe, expect, it, vi } from 'vitest';

// strangeramblings.com/app offers the install only to a Safari a join link
// was opened in, and says whether the newest copy includes that person's phone.

const SECRET = 'app-page-secret'.padEnd(40, 'x');

vi.mock('$env/dynamic/private', () => ({ env: { AUTH_SECRET: 'app-page-secret'.padEnd(40, 'x') } }));
vi.mock('$lib/github/adhoc-builds', () => ({
  adhocBuildRunning: async () => false,
}));
vi.mock('$lib/github/app-release', () => ({
  releasedAdhocBuild: async () => ({ version: '0.1.120', builtAt: null, devices: ["Rory's iPhone"], bundleId: 'b', build: '120', commit: 'c', ipaAssetId: 1, ipaBytes: 1 }),
}));

const { load } = await import('./+page.server');
const { appCookie, installToken } = await import('$lib/server/adhoc-install');

function event(cookie?: string) {
  return {
    cookies: { get: () => cookie },
    url: new URL('https://strangeramblings.com/app'),
    setHeaders: () => {},
  };
}

describe('/app', () => {
  it('shows a stranger nothing but the way to ask', async () => {
    expect(await load(event() as never)).toEqual({ known: false });
    expect(await load(event('rory.forgedforgedforgedforg') as never)).toEqual({ known: false });
  });

  it('offers the install to a phone whose copy is ready', async () => {
    const page = (await load(event(appCookie('rory', SECRET)) as never)) as Record<string, unknown>;
    expect(page.name).toBe('Rory');
    expect(page.included).toBe(true);
    expect(String(page.install)).toContain(encodeURIComponent(`/install/${installToken(SECRET)}/manifest.plist`));
  });

  it('says so when the copy does not include their phone yet', async () => {
    const page = (await load(event(appCookie('fintan', SECRET)) as never)) as Record<string, unknown>;
    expect(page.included).toBe(false);
  });
});
