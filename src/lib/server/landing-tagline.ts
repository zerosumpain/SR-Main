// The landing tagline, kept in app_settings under one key. Read by the landing
// page's load on every render (through the settings module's 30s cache, which
// a save or reset here clears in this process at once) and edited from
// /admin/content/hero.
import { deleteSetting, getSetting, setSetting } from '$lib/server/models/settings';
import { DEFAULT_LANDING_TAGLINE } from '$lib/constants/landing-tagline';
import { landingTaglineSchema } from './landing-tagline-schema';

export const LANDING_TAGLINE_KEY = 'landing.tagline';

/**
 * How long the landing load waits for the read. The pool has five connections
 * and no acquire timeout, and this read sits in the landing's awaited
 * Promise.all, so a busy pool would otherwise hold up first paint.
 */
export const LANDING_TAGLINE_READ_MS = 300;

/**
 * The last tagline read successfully in this process, served while a read
 * fails or runs late so an outage keeps the owner's line rather than flipping
 * to the default. Undefined until the first good read.
 */
let lastGood: string | undefined;

/** The owner's saved tagline, or null when none is saved (or what is saved no longer validates). */
export async function getSavedLandingTagline(): Promise<string | null> {
  const stored = await getSetting<{ text?: unknown }>(LANDING_TAGLINE_KEY);
  const parsed = landingTaglineSchema.safeParse(stored?.text);
  return parsed.success && parsed.data ? parsed.data : null;
}

/**
 * The tagline the masthead shows. Never throws and never waits longer than
 * LANDING_TAGLINE_READ_MS: a failed or slow read serves the last good line
 * (or the default before there is one), so the front page never breaks or
 * stalls over its subtitle.
 */
export async function getLandingTagline(): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), LANDING_TAGLINE_READ_MS);
  });
  const read = getSavedLandingTagline().then(
    (saved) => (lastGood = saved ?? DEFAULT_LANDING_TAGLINE),
    () => undefined,
  );
  try {
    return (await Promise.race([read, late])) ?? lastGood ?? DEFAULT_LANDING_TAGLINE;
  } finally {
    clearTimeout(timer);
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
  lastGood = text || DEFAULT_LANDING_TAGLINE;
}
