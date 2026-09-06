import { heroBackgroundSchema } from '$lib/server/hero-background-schema';
import { getSetting, setSetting } from '$lib/server/models/settings';
import { HERO_BACKGROUND_DEFAULTS } from '$lib/constants/hero-background';
import type { HeroBackgroundAsset, HeroBackgroundSettings } from '$lib/constants/hero-background';
import asset from '$lib/constants/hero-background-asset.json';
import { selectedHero } from './hero-sources';

const KEY = 'landing.hero.background';
export const heroBackgroundAsset = asset as HeroBackgroundAsset | null;

export async function getHeroBackgroundAsset() {
  return (await selectedHero())?.asset ?? heroBackgroundAsset;
}

export async function getHeroBackgroundSettings(): Promise<HeroBackgroundSettings> {
  const saved = await getSetting(KEY);
  const result = heroBackgroundSchema.safeParse(saved ?? {});
  return result.success ? result.data : { ...HERO_BACKGROUND_DEFAULTS };
}

export async function saveHeroBackgroundSettings(value: unknown): Promise<void> {
  await setSetting(KEY, heroBackgroundSchema.parse(value));
}
