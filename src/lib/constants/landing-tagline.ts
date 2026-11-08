// The line under "JK's strange ramblings" on the landing masthead (HeroTitle).
// The owner edits it at /admin/content/hero; this is what shows while no edit is
// saved. Client-safe: the admin panel reads the cap and the default from here.

/** The built-in tagline, used whenever the `landing.tagline` setting is unset. */
export const DEFAULT_LANDING_TAGLINE = 'I say things, I do things, and I share things. And look hey, now you see things';

/** Longest tagline accepted, in UTF-16 units (the unit of both zod's max and an input's maxlength). */
export const LANDING_TAGLINE_MAX = 200;
