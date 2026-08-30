/**
 * The blog's font vocabulary.
 *
 * Two separate things use this, and they must agree or the picker offers a
 * value the renderer then strips:
 *
 *  - the POST-LEVEL body face (`blog_posts.body_font`), chosen once per post
 *    and applied to the whole reading column;
 *  - the INLINE span face, chosen from the editor toolbar and written into the
 *    saved HTML as `style="font-family: var(--font-…)"`.
 *
 * The sanitiser in `./renderer` admits a `font-family` declaration ONLY where it
 * matches `var(--font-<one of these keys>)`. That allow-list is what stops the
 * picker becoming an arbitrary-font hole, so any key added here must be added
 * to `FONT_FAMILY_STYLE_PATTERN` in the same change — which is why the pattern
 * is built from this list rather than written out a second time.
 *
 * Lives in $lib/blog rather than the Drizzle schema because `schema.ts` must
 * have NO local imports at all: `ci-release.sh` rsyncs that one file to the VPS
 * and runs `drizzle-kit push` against it, where a `$lib` specifier resolves to
 * nothing and fails the push while the release still reports success.
 */

export const BODY_FONT_KEYS = ['read', 'body', 'display', 'mono', 'brand'] as const;

export type BodyFont = (typeof BODY_FONT_KEYS)[number];

/**
 * The default reading face for a post: the self-hosted Selawik stack with real
 * Segoe UI behind it, the same face /jkai runs on. Deliberately NOT the site's
 * DM Sans — a long-form reading column and a page of navigation chrome are
 * different jobs, and this is the one John asked for by name.
 */
export const DEFAULT_BODY_FONT: BodyFont = 'read';

export type FontOption = {
  key: BodyFont;
  /** What the picker shows. */
  label: string;
  /** The CSS custom property this key resolves to. */
  cssVar: string;
  /** One line of help, shown as the option's title attribute. */
  hint: string;
  /** Offered as a post-level body face. Display and Brand are not: a whole
   *  article set in Archivo Black is unreadable, and that is not a choice worth
   *  making available by accident. Both remain available inline. */
  bodyEligible: boolean;
};

export const FONT_OPTIONS: readonly FontOption[] = [
  {
    key: 'read',
    label: 'Reading',
    cssVar: 'var(--font-read)',
    hint: 'Selawik / Segoe UI — the long-form reading face. Default.',
    bodyEligible: true,
  },
  {
    key: 'body',
    label: 'Sans',
    cssVar: 'var(--font-body)',
    hint: 'DM Sans — the site body face.',
    bodyEligible: true,
  },
  {
    key: 'mono',
    label: 'Mono',
    cssVar: 'var(--font-mono)',
    hint: 'JetBrains Mono — labels, code, anything that wants to look typed.',
    bodyEligible: true,
  },
  {
    key: 'display',
    label: 'Display',
    cssVar: 'var(--font-display)',
    hint: 'Archivo Black — headlines. Inline emphasis only.',
    bodyEligible: false,
  },
  {
    key: 'brand',
    label: 'Brand',
    cssVar: 'var(--font-brand)',
    hint: 'DM Mono — the brand mark face. Inline emphasis only.',
    bodyEligible: false,
  },
];

/** The subset offered as a post's body face. */
export const BODY_FONT_OPTIONS: readonly FontOption[] = FONT_OPTIONS.filter((f) => f.bodyEligible);

function isBodyFont(v: unknown): v is BodyFont {
  return typeof v === 'string' && (BODY_FONT_KEYS as readonly string[]).includes(v);
}

/**
 * Resolve a stored `body_font` value to a CSS custom property reference.
 *
 * Anything unrecognised — an older row, a hand-edited value, a key removed from
 * the vocabulary — falls back to the default rather than being emitted
 * verbatim. Emitting it verbatim is the hole the sanitiser exists to close, and
 * this function is on the render path, so it closes it here too.
 */
export function bodyFontVar(value: unknown): string {
  const key = isBodyFont(value) ? value : DEFAULT_BODY_FONT;
  return FONT_OPTIONS.find((f) => f.key === key)!.cssVar;
}

/** The stored key, normalised. */
export function normaliseBodyFont(value: unknown): BodyFont {
  return isBodyFont(value) ? value : DEFAULT_BODY_FONT;
}

/**
 * The sanitiser's `font-family` allow-list, derived from the vocabulary above
 * so the two can never drift. `--font-sans` is kept as an accepted alias
 * because posts written before this module existed contain it: it is an alias
 * of `--font-body` in `app.css`, and dropping it here would silently strip the
 * font off already-published prose.
 */
export const FONT_FAMILY_STYLE_PATTERN = new RegExp(
  `^var\\(--font-(?:sans|${BODY_FONT_KEYS.join('|')})\\)$`,
);
