import { beforeEach, describe, expect, it, vi } from 'vitest';

// The landing page's load, with every reader faked: this checks only that the
// masthead's tagline reaches the page (the owner's line, or the default when
// the store has none or cannot be read). The store's own fallbacks are tested
// in $lib/server/landing-tagline.test.ts.

vi.mock('$app/environment', () => ({ dev: false, browser: false, building: false }));
vi.mock('$lib/landing/steps-today.server', () => ({ stepsToday: async () => null }));
vi.mock('$lib/landing/ramblers/day.server', () => ({ ramblerDay: async () => ({}) }));
vi.mock('$lib/releases/public', () => ({ getReleaseShowcase: async () => null }));
vi.mock('$lib/landing/capabilities.server', () => ({ loadCapabilityFacts: async () => ({}) }));
vi.mock('$lib/landing/showcase.server', () => ({ loadShowcase: async () => ({}) }));
vi.mock('$lib/landing/sun.server', () => ({ ownerSun: async () => null }));
vi.mock('$lib/blog', () => ({ getAllPosts: async () => [] }));
vi.mock('$lib/server/owner', () => ({ isOwnerRequest: async () => false }));

const getSetting = vi.fn();
vi.mock('$lib/server/models/settings', () => ({ getSetting, setSetting: vi.fn(), deleteSetting: vi.fn() }));

const { DEFAULT_LANDING_TAGLINE } = await import('$lib/constants/landing-tagline');
// Imported fresh per test: the tagline store remembers its last good line.
let load: typeof import('./+page.server').load;

function event() {
  const headers: Record<string, string> = {};
  return {
    fetch: async () => new Response('{}'),
    locals: {},
    getClientAddress: () => '203.0.113.9',
    cookies: { get: () => undefined },
    url: new URL('https://strangeramblings.com/'),
    setHeaders: (h: Record<string, string>) => Object.assign(headers, h),
    headers,
  };
}

async function run() {
  const e = event();
  const data = (await load(e as unknown as Parameters<typeof load>[0])) as { tagline: string };
  return { data, headers: e.headers };
}

beforeEach(async () => {
  getSetting.mockReset();
  vi.resetModules();
  ({ load } = await import('./+page.server'));
});

describe('landing load: tagline', () => {
  it('passes the owner’s saved tagline', async () => {
    getSetting.mockImplementation(async (key: string) => (key === 'landing.tagline' ? { text: 'A new line.' } : null));
    expect((await run()).data.tagline).toBe('A new line.');
  });

  it('passes the default when none is saved', async () => {
    getSetting.mockResolvedValue(null);
    expect((await run()).data.tagline).toBe(DEFAULT_LANDING_TAGLINE);
  });

  it('passes the default, and still renders, when the database read fails', async () => {
    getSetting.mockRejectedValue(new Error('no database'));
    expect((await run()).data.tagline).toBe(DEFAULT_LANDING_TAGLINE);
  });

  // Not new with the tagline, but the tagline depends on it: a shared cache
  // would keep serving the old line after a save.
  it('stays out of shared caches, so a saved tagline shows on the next load', async () => {
    getSetting.mockResolvedValue(null);
    expect((await run()).headers['cache-control']).toBe('private, no-cache');
  });
});
