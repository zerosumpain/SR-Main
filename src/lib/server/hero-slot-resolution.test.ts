import { describe, expect, it, vi } from 'vitest';
const { selected } = vi.hoisted(() => ({ selected: vi.fn() }));
vi.mock('./hero-sources', () => ({ selectedHero: selected }));
vi.mock('$lib/server/models/settings', () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
import { getHeroBackgroundAsset, heroBackgroundAsset } from './hero-background';

describe('hero slot fallback', () => {
  it('preserves the existing default assignment', async () => {
    const asset = { desktop: '/existing.mp4' };
    selected.mockImplementation(async slot => !slot || slot === 'default' ? { asset } : null);
    expect(await getHeroBackgroundAsset('weekend-inactive')).toBe(asset);
    expect(await getHeroBackgroundAsset()).toBe(asset);
  });
  it('uses the exact match ahead of default', async () => {
    const asset = { desktop: '/weekend.mp4' };
    selected.mockImplementation(async slot => slot === 'weekend-very-active' ? { asset } : { asset: { desktop: '/default.mp4' } });
    expect(await getHeroBackgroundAsset('weekend-very-active')).toBe(asset);
  });
  it('uses the bundled asset when both assignments are empty', async () => {
    selected.mockResolvedValue(null);
    expect(await getHeroBackgroundAsset('weekday-average')).toBe(heroBackgroundAsset);
  });
});
