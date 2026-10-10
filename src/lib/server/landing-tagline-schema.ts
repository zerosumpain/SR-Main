import { z } from 'zod';
import { LANDING_TAGLINE_MAX } from '$lib/constants/landing-tagline';

/**
 * One tagline as typed into the admin panel. Trimmed, one line of plain text,
 * at most LANDING_TAGLINE_MAX characters. Punctuation is left exactly as typed:
 * curly quotes and apostrophes are the house style, never straightened.
 *
 * An empty result is valid and means "back to the default": the caller deletes
 * the setting rather than storing an empty string.
 */
export const landingTaglineSchema = z
  .string()
  .trim()
  .max(LANDING_TAGLINE_MAX, `Keep the tagline to ${LANDING_TAGLINE_MAX} characters or fewer.`)
  // Control characters (line breaks, tabs, NUL) can only arrive from a forged
  // POST, since a single-line input cannot hold them. The masthead is one line.
  .refine((s) => !/\p{Cc}/u.test(s), 'Keep the tagline to one line of plain text.');
