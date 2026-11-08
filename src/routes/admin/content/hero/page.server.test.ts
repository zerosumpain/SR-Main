import { beforeEach, describe, expect, it, vi } from 'vitest';

// /admin/content/hero's tagline action, with the settings store faked. The
// route is owner-only by the hook (the catalogue opens it to showcase viewers
// for GET alone), so this checks only what the action does with a form.

vi.mock('$lib/server/hero-background', () => ({
  getHeroBackgroundSettings: vi.fn(), getHeroBackgroundAsset: vi.fn(), saveHeroBackgroundSettings: vi.fn(),
}));
vi.mock('$lib/server/hero-sources', () => ({
  heroSourceOptions: vi.fn(), selectedHero: vi.fn(), heroPreparation: vi.fn(), heroSlotAssignments: vi.fn(),
}));
vi.mock('$lib/server/hero-activity', () => ({
  getHeroActivity: vi.fn(), getHeroActivityRules: vi.fn(), saveHeroActivityRules: vi.fn(),
}));
vi.mock('$lib/server/showcase', () => ({ isShowcase: async () => false }));
const getSetting = vi.fn(async (_key: string): Promise<unknown> => null);
const setSetting = vi.fn(async () => {});
const deleteSetting = vi.fn(async () => {});
vi.mock('$lib/server/models/settings', () => ({ getSetting, setSetting, deleteSetting }));

const { actions, load } = await import('./+page.server');

function post(form: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(form)) body.set(k, v);
  const request = new Request('https://strangeramblings.com/admin/content/hero?/tagline', { method: 'POST', body });
  return actions.tagline!({ request } as unknown as Parameters<NonNullable<typeof actions.tagline>>[0]);
}

beforeEach(() => {
  getSetting.mockReset();
  getSetting.mockResolvedValue(null);
  setSetting.mockClear();
  deleteSetting.mockClear();
});

describe('hero admin: tagline action', () => {
  it('saves the trimmed line', async () => {
    expect(await post({ tagline: '  A new line, JK’s own.  ' })).toEqual({ taglineSaved: true, taglineReset: false });
    expect(setSetting).toHaveBeenCalledWith('landing.tagline', { text: 'A new line, JK’s own.' });
  });

  it('treats an empty save as a reset', async () => {
    expect(await post({ tagline: '   ' })).toEqual({ taglineSaved: true, taglineReset: true });
    expect(deleteSetting).toHaveBeenCalledWith('landing.tagline');
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('refuses an over-long line and hands back no more than the box holds', async () => {
    const long = 'x'.repeat(5000);
    const result = (await post({ tagline: long })) as { status: number; data: { taglineError: string; taglineValue: string } };
    expect(result.status).toBe(400);
    expect(result.data.taglineError).toMatch(/200 characters/);
    expect(result.data.taglineValue).toBe('x'.repeat(200));
    expect(setSetting).not.toHaveBeenCalled();
    expect(deleteSetting).not.toHaveBeenCalled();
  });

  it('refuses invisible characters and hands the typed line back for the no-JS box', async () => {
    const result = (await post({ tagline: 'abc\u202Edef' })) as { status: number; data: { taglineError: string; taglineValue: string } };
    expect(result.status).toBe(400);
    expect(result.data.taglineError).toMatch(/invisible characters/);
    expect(result.data.taglineValue).toBe('abc\u202Edef');
    expect(setSetting).not.toHaveBeenCalled();
  });
});

describe('hero admin: load', () => {
  async function loaded() {
    const event = { url: new URL('https://strangeramblings.com/admin/content/hero') };
    return (await load(event as unknown as Parameters<typeof load>[0])) as { tagline: string | null };
  }

  it('gives the panel null while no line is saved', async () => {
    expect((await loaded()).tagline).toBeNull();
  });

  it('gives the panel the saved line', async () => {
    getSetting.mockImplementation(async (key: string) => (key === 'landing.tagline' ? { text: 'Mine.' } : null));
    expect((await loaded()).tagline).toBe('Mine.');
  });
});
