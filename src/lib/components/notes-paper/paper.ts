// paper.ts — the small pure helpers behind the notes-paper kit: which ruling
// a body face gets, which coloured pencil marks a word, and how a count is
// said when it is drawn as a tally. Pure, so the server and the browser agree
// and the rules are unit tests (paper.test.ts).

/** The body faces the ruling is measured for. */
export const NP_FONTS = ['read', 'body', 'mono'] as const;
export type NpFont = (typeof NP_FONTS)[number];

/**
 * The two inline-only faces an older post may still hold as its whole-post
 * face, ruled as the measured face nearest them: the display face (Inter,
 * baseline ratio 0.36) at the body size as DM Sans (0.34), the brand's DM Mono
 * as the monospaced face, with its smaller size and wider measure.
 */
const NEAREST: Record<string, NpFont> = { display: 'body', brand: 'mono' };

/**
 * The `data-np-font` value for a stored body face key (a post's `body_font`).
 * Unknown or missing keys fall back to `read`, the blog's default face, the
 * same fallback $lib/blog/fonts applies when it resolves the face itself.
 */
export function npFont(value: unknown): NpFont {
  if (typeof value !== 'string') return 'read';
  if ((NP_FONTS as readonly string[]).includes(value)) return value as NpFont;
  return Object.hasOwn(NEAREST, value) ? NEAREST[value] : 'read';
}

/**
 * The coloured pencils, in a fixed order: orange, petrol, olive, ochre. Each is
 * dark enough to read as a mark on the cream paper; none is ever the only
 * thing that says what a mark means (the word beside it does).
 */
export const PENCILS = ['var(--accent)', 'var(--accent-ink)', 'var(--good)', '#8c6a12'] as const;

/** A stable pencil for a word (a tag, a name): the same word, the same colour, everywhere. */
export function pencilFor(word: string): number {
  let h = 2166136261;
  for (const ch of word.trim().toLowerCase()) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % PENCILS.length;
}

/** A seed for the pen's wobble from a word (case aside), so each mark is drawn once and drawn the same. */
export function seedFor(word: string): number {
  let h = 7;
  for (const ch of word.trim().toLowerCase()) h = (Math.imul(h, 31) + (ch.codePointAt(0) ?? 0)) | 0;
  return Math.abs(h) || 1;
}

/** Five-bar gates and the odd strokes left over, for a count drawn as a tally. */
export function tallyParts(count: number): { gates: number; odd: number } {
  const n = Math.max(0, Math.floor(count));
  return { gates: Math.floor(n / 5), odd: n % 5 };
}
