// Name normalisers — the pure subset of SR-Jkai-Core's `resolve/match` that
// Main still uses: chat grounding's anchor lookup, the intel graph tools'
// fuzzy lookup, and the news desk's correlation. No database, no imports.
//
// Copied verbatim from Core, so a name Main looks up is normalised the way Core
// stored it. Change them there first.

/** Words that carry no identity and should not drive a name match. */
const NOISE_WORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'for', 'to', 'in', 'on', 'at', 'by', 'with',
  'ltd', 'limited', 'plc', 'inc', 'llc', 'group', 'team',
]);

/** Lowercase, strip punctuation and possessives, collapse whitespace. */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    // Possessives, in every apostrophe the wild produces: "IBCA's" → "ibca".
    // Must run before punctuation stripping, or the apostrophe becomes a space
    // and leaves a stray "s" token behind.
    .replace(/['‘’ʼ`]s\b/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

/** Significant tokens of a name, noise words removed. */
export function significantTokens(name: string): string[] {
  return normaliseName(name)
    .split(' ')
    .filter((t) => t && !NOISE_WORDS.has(t));
}

/**
 * Acronyms a name could be known by — used for BLOCKING only.
 *
 * Deliberately more generous than `isAcronymPair`, which decides matches:
 * blocking only proposes pairs for scoring, so a loose parenthetical here costs
 * a comparison, while the same looseness in the matcher cost real merges.
 *
 *   - anything in parentheses that looks like an acronym
 *   - the initials of its significant words
 * "Infected Blood Compensation Authority (IBCA)" yields both "ibca" (explicit)
 * and "ibca" (initials) — which is exactly why it resolves.
 */
export function acronymsOf(name: string): Set<string> {
  const out = new Set<string>();

  for (const m of name.matchAll(/\(([^)]{2,12})\)/g)) {
    const inner = m[1].trim();
    if (/^[A-Za-z][A-Za-z.&-]*$/.test(inner) && inner.replace(/[^A-Za-z]/g, '').length >= 2) {
      out.add(inner.replace(/[^A-Za-z]/g, '').toLowerCase());
    }
  }

  // Initials of the name with any parenthetical removed.
  const bare = name.replace(/\([^)]*\)/g, ' ');
  const tokens = significantTokens(bare);
  if (tokens.length >= 2 && tokens.length <= 8) {
    out.add(tokens.map((t) => t[0]).join(''));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Canonical form
// ---------------------------------------------------------------------------

/**
 * Noise for CANONICAL comparison, which is stricter than NOISE_WORDS.
 *
 * `group` and `team` are absent on purpose. They are noise when weighing how
 * much two names overlap, and identity-bearing when asking whether two names
 * are the same thing: "Security" and "Security Team" are a concept and an
 * organisation, and canonical equality auto-merges, so it must not fire there.
 */
const CANONICAL_NOISE = new Set([
  'the', 'a', 'an', 'of', 'and', 'for', 'to', 'in', 'on', 'at', 'by', 'with',
  'ltd', 'limited', 'plc', 'inc', 'llc', 'llp', 'gmbh', 'bv', 'nv', 'ag', 'co',
]);

/**
 * Extensions a name carries when it arrived as a FILE rather than a title.
 *
 * A closed list rather than "anything after the last dot", because that rule
 * turns "Node.js" into "node" and every version string into a truncation.
 */
const FILE_EXTENSIONS = new Set([
  'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'pdf', 'csv', 'tsv', 'txt', 'rtf',
  'md', 'json', 'yaml', 'yml', 'sql', 'ts', 'tsx', 'js', 'mjs', 'cjs', 'py', 'sh',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'zip',
]);

/**
 * Strip a namespace prefix: `z-ai/glm-5-turbo`, `zerosumpain/SR-Main`,
 * `canvas:morning-briefing`.
 *
 * Two conditions, both learned from names this got wrong:
 *
 *   - the WHOLE name carries no whitespace. "M62/A1 corridor" is two roads and
 *     a noun, not a namespace and a name, and stripping it merged the entity
 *     into "A1 corridor". "Church Lane / Preston Park area" is the same shape.
 *   - what remains is slug-shaped (contains `-` or `_`). "Web/Dashboard" has no
 *     whitespace either, and "Dashboard" is not a slug — it is the second half
 *     of a phrase.
 *
 * The cost is recall: `Z.AI/zai provider` no longer unwraps, because its
 * remainder is prose. Precision is the priority — this signal auto-merges.
 */
function stripNamespace(name: string): string {
  const trimmed = name.trim();
  if (/\s/.test(trimmed)) return name;
  const m = /^([\p{L}\p{N}._-]+)[/:](.+)$/u.exec(trimmed);
  if (!m) return name;
  const rest = m[2].trim();
  if (!rest || rest.startsWith('/')) return name;
  if (!/[-_]/.test(rest)) return name;
  return rest;
}

/** Strip a known file extension, provided something nameable is left. */
function stripFileExtension(name: string): string {
  const m = /^(.*)\.([\p{L}\p{N}]{1,5})$/u.exec(name.trim());
  if (!m) return name;
  if (!FILE_EXTENSIONS.has(m[2].toLowerCase())) return name;
  // "Node.js" would otherwise become "Node" and match a concept of that name.
  // A real filename has more than one word left once the extension goes.
  const base = m[1].trim();
  return significantTokens(base).length >= 2 ? base : name;
}

/**
 * The form of a name to test for EQUALITY, once the packaging is removed.
 *
 * Names reach the graph wearing three kinds of packaging that say nothing about
 * identity: a file extension (`…Data Strategy.docx`), a namespace prefix
 * (`z-ai/glm-5-turbo`), and a legal suffix (`Google LLC`). `normaliseName`
 * already handles case and separators, so `sr-design-system` and
 * `SR design system` meet without help — these three do not.
 *
 * Word ORDER is preserved. Sorting would make "Data Strategy" and "Strategy
 * Data" equal, and nothing in the corpus needs that; person-name reordering is
 * `isNameReordering`'s job and is gated to people.
 */
export function canonicalName(name: string): string {
  const stripped = stripFileExtension(stripNamespace(name));
  return normaliseName(stripped)
    .split(' ')
    .filter((t) => t && !CANONICAL_NOISE.has(t))
    .join(' ');
}

