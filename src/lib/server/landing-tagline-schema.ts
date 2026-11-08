import { z } from 'zod';
import { LANDING_TAGLINE_MAX } from '$lib/constants/landing-tagline';

/** Characters that are not part of one line of visible text (U+200D, the emoji joiner, is allowed). */
const NOT_ONE_LINE = /(?!\u200d)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

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
  // One visible line: no control characters (line breaks, tabs, NUL, which
  // only a forged POST can carry past a single-line input), no line or
  // paragraph separators (U+2028/U+2029, which some editors paste), and no
  // invisible format characters (Cf: bidi overrides such as U+202E would
  // reverse the public masthead; zero-width spaces hide in pasted text). The
  // zero-width joiner U+200D is the one exception, as emoji sequences need it.
  .refine((s) => !NOT_ONE_LINE.test(s), 'Keep the tagline to one line of plain text, with no line breaks or invisible characters.');
