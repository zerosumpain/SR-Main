// The landing tagline, kept in app_settings under one key. Read by the landing
// page's load on every render (through the settings module's 30s cache, which
// a save or reset here clears in this process at once, and which a read already
// running when the save lands does not refill) and edited from
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
 * The wait while this process has no good read yet. Every merge restarts the
 * server, and its first read opens a fresh connection while the landing's
 * other reads queue for the same pool; at 300ms the first visitors after a
 * deploy would see the default line instead of the owner's. Used until a read
 * succeeds or one of these longer waits runs out, so a database that hangs
 * from startup costs this once, not on every request.
 */
export const LANDING_TAGLINE_COLD_READ_MS = 1_000;

/**
 * The last tagline read successfully in this process, served while a read
 * fails or runs late so an outage keeps the owner's line rather than flipping
 * to the default. Undefined until the first good read.
 */
let lastGood: string | undefined;

/** Set once a cold-start wait has run out; later reads use the short wait. */
let coldWaitSpent = false;

/**
 * Bumped by every save. A read that began before a save can return the line
 * as it was; it must not then overwrite lastGood with it.
 */
let saves = 0;

/** The owner's saved tagline, or null when none is saved (or what is saved no longer validates). */
export async function getSavedLandingTagline(): Promise<string | null> {
  const stored = await getSetting<{ text?: unknown }>(LANDING_TAGLINE_KEY);
  const parsed = landingTaglineSchema.safeParse(stored?.text);
  return parsed.success && parsed.data ? parsed.data : null;
}

/**
 * The tagline the masthead shows. Never throws and never waits longer than
 * LANDING_TAGLINE_READ_MS (LANDING_TAGLINE_COLD_READ_MS before the process's
 * first good read): a failed or slow read serves the last good line
 * (or the default before there is one), so the front page never breaks or
 * stalls over its subtitle.
 */
export async function getLandingTagline(): Promise<string> {
  const cold = lastGood === undefined && !coldWaitSpent;
  const wait = cold ? LANDING_TAGLINE_COLD_READ_MS : LANDING_TAGLINE_READ_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      if (cold) coldWaitSpent = true;
      resolve(undefined);
    }, wait);
  });
  const savesAtStart = saves;
  const read = getSavedLandingTagline().then(
    (saved) => {
      const line = saved ?? DEFAULT_LANDING_TAGLINE;
      if (saves === savesAtStart) lastGood = line;
      return line;
    },
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
  saves++;
  lastGood = text || DEFAULT_LANDING_TAGLINE;
}
