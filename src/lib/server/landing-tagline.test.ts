import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LANDING_TAGLINE } from '$lib/constants/landing-tagline';

const getSetting = vi.fn();
const setSetting = vi.fn(async () => {});
const deleteSetting = vi.fn(async () => {});
vi.mock('$lib/server/models/settings', () => ({ getSetting, setSetting, deleteSetting }));

const { LANDING_TAGLINE_KEY, getLandingTagline, getSavedLandingTagline, saveLandingTagline } = await import('./landing-tagline');

beforeEach(() => {
  getSetting.mockReset();
  setSetting.mockClear();
  deleteSetting.mockClear();
});

describe('landing tagline store', () => {
  it('keeps one app_settings key', () => {
    expect(LANDING_TAGLINE_KEY).toBe('landing.tagline');
  });

  it('returns the saved line', async () => {
    getSetting.mockResolvedValue({ text: 'Something new.' });
    expect(await getLandingTagline()).toBe('Something new.');
    expect(getSetting).toHaveBeenCalledWith('landing.tagline');
  });

  it('falls back to the default when unset', async () => {
    getSetting.mockResolvedValue(null);
    expect(await getLandingTagline()).toBe(DEFAULT_LANDING_TAGLINE);
    expect(await getSavedLandingTagline()).toBeNull();
  });

  it('falls back to the default when the database read fails', async () => {
    getSetting.mockRejectedValue(new Error('connection refused'));
    expect(await getLandingTagline()).toBe(DEFAULT_LANDING_TAGLINE);
  });

  it.each([{ text: '' }, { text: 'x'.repeat(201) }, { text: 7 }, 'a bare string', { other: 'x' }])(
    'ignores a stored value that no longer validates: %j',
    async (stored) => {
      getSetting.mockResolvedValue(stored);
      expect(await getLandingTagline()).toBe(DEFAULT_LANDING_TAGLINE);
    },
  );

  it('stores a line as { text }', async () => {
    await saveLandingTagline('A line.');
    expect(setSetting).toHaveBeenCalledWith('landing.tagline', { text: 'A line.' });
    expect(deleteSetting).not.toHaveBeenCalled();
  });

  it('deletes the setting for an empty line, so the default shows', async () => {
    await saveLandingTagline('');
    expect(deleteSetting).toHaveBeenCalledWith('landing.tagline');
    expect(setSetting).not.toHaveBeenCalled();
  });
});
