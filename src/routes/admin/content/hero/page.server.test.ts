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
const setSetting = vi.fn(async () => {});
const deleteSetting = vi.fn(async () => {});
vi.mock('$lib/server/models/settings', () => ({ getSetting: vi.fn(async () => null), setSetting, deleteSetting }));

const { actions } = await import('./+page.server');

function post(form: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(form)) body.set(k, v);
  const request = new Request('https://strangeramblings.com/admin/content/hero?/tagline', { method: 'POST', body });
  return actions.tagline!({ request } as unknown as Parameters<NonNullable<typeof actions.tagline>>[0]);
}

beforeEach(() => {
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

  it('resets from the button whatever the box holds', async () => {
    expect(await post({ tagline: 'ignored', intent: 'reset' })).toEqual({ taglineSaved: true, taglineReset: true });
    expect(deleteSetting).toHaveBeenCalledWith('landing.tagline');
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('refuses an over-long line and hands it back for editing', async () => {
    const long = 'x'.repeat(201);
    const result = (await post({ tagline: long })) as { status: number; data: { taglineError: string; taglineValue: string } };
    expect(result.status).toBe(400);
    expect(result.data.taglineError).toMatch(/200 characters/);
    expect(result.data.taglineValue).toBe(long);
    expect(setSetting).not.toHaveBeenCalled();
    expect(deleteSetting).not.toHaveBeenCalled();
  });
});
