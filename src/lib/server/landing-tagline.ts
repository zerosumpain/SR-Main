// The landing tagline, kept in app_settings under one key. Read by the landing
// page's load on every render (through the settings module's 30s cache, which
// a save or reset here clears in this process at once) and edited from
// /admin/content/hero.
import { deleteSetting, getSetting, setSetting } from '$lib/server/models/settings';
import { DEFAULT_LANDING_TAGLINE } from '$lib/constants/landing-tagline';
import { landingTaglineSchema } from './landing-tagline-schema';

export const LANDING_TAGLINE_KEY = 'landing.tagline';

/** The owner's saved tagline, or null when none is saved (or what is saved no longer validates). */
export async function getSavedLandingTagline(): Promise<string | null> {
  const stored = await getSetting<{ text?: unknown }>(LANDING_TAGLINE_KEY);
  const parsed = landingTaglineSchema.safeParse(stored?.text);
  return parsed.success && parsed.data ? parsed.data : null;
}

/**
 * The tagline the masthead shows. Never throws: an unreadable database falls
 * back to the default, so the front page never breaks over its subtitle.
 */
export async function getLandingTagline(): Promise<string> {
  try {
    return (await getSavedLandingTagline()) ?? DEFAULT_LANDING_TAGLINE;
  } catch {
    return DEFAULT_LANDING_TAGLINE;
  }
}

/**
 * Save a tagline that has already passed landingTaglineSchema. Empty means
 * "back to the default", stored as no row at all (app_settings.value is
 * jsonb NOT NULL, and absent already reads as the default).
 */
export async function saveLandingTagline(text: string): Promise<void> {
  if (!text) await deleteSetting(LANDING_TAGLINE_KEY);
  else await setSetting(LANDING_TAGLINE_KEY, { text });
}
