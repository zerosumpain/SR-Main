import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LANDING_TAGLINE } from '$lib/constants/landing-tagline';

const getSetting = vi.fn();
const setSetting = vi.fn(async () => {});
const deleteSetting = vi.fn(async () => {});
vi.mock('$lib/server/models/settings', () => ({ getSetting, setSetting, deleteSetting }));

// A fresh module per test: the store keeps the last good line in a module
// variable, which would otherwise carry from one test into the next.
let store: typeof import('./landing-tagline');
let LANDING_TAGLINE_KEY: string;
let getLandingTagline: () => Promise<string>;
let getSavedLandingTagline: () => Promise<string | null>;
let saveLandingTagline: (text: string) => Promise<void>;

beforeEach(async () => {
  getSetting.mockReset();
  setSetting.mockClear();
  deleteSetting.mockClear();
  vi.resetModules();
  store = await import('./landing-tagline');
  ({ LANDING_TAGLINE_KEY, getLandingTagline, getSavedLandingTagline, saveLandingTagline } = store);
});

afterEach(() => {
  vi.useRealTimers();
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

  it('serves the default, without waiting, when the read hangs', async () => {
    vi.useFakeTimers();
    getSetting.mockReturnValue(new Promise(() => {}));
    const shown = getLandingTagline();
    await vi.advanceTimersByTimeAsync(store.LANDING_TAGLINE_READ_MS);
    expect(await shown).toBe(DEFAULT_LANDING_TAGLINE);
  });

  it('keeps the last good line through a failed or hung read', async () => {
    getSetting.mockResolvedValueOnce({ text: 'The owner’s line.' });
    expect(await getLandingTagline()).toBe('The owner’s line.');

    getSetting.mockRejectedValueOnce(new Error('connection refused'));
    expect(await getLandingTagline()).toBe('The owner’s line.');

    vi.useFakeTimers();
    getSetting.mockReturnValueOnce(new Promise(() => {}));
    const shown = getLandingTagline();
    await vi.advanceTimersByTimeAsync(store.LANDING_TAGLINE_READ_MS);
    expect(await shown).toBe('The owner’s line.');
  });

  it('counts a save as the last good line', async () => {
    await saveLandingTagline('Just saved.');
    getSetting.mockRejectedValue(new Error('connection refused'));
    expect(await getLandingTagline()).toBe('Just saved.');
    await saveLandingTagline('');
    expect(await getLandingTagline()).toBe(DEFAULT_LANDING_TAGLINE);
  });
});
