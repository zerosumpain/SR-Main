// src/lib/daydream/cites.ts
//
// One rule for reading a citation back off a model's answer.
//
// ── Why this file exists ────────────────────────────────────────────────────
//
// Every prompt surface in this engine renders evidence as a keyed line and then
// requires the model to cite the key it used, and every one of those audits is
// a set-membership test. That test is exact, which means the RENDERING and the
// AUDIT have to agree on the spelling of a key down to the punctuation — and
// when they disagree, nothing errors. The lane reports success, the counter
// reads zero, and the drop list quietly fills with "cites nothing in the pack".
//
// That is not hypothetical. `renderAppetitePack` prints each fact as
// `[intent:0] …` and the prompt told the model to cite the `[key]` VERBATIM.
// It complied, and `packKeys.has('[intent:0]')` was false against a set holding
// `intent:0`. The capability lane ran for thirteen consecutive nights at a
// 100% audit-drop rate — roughly forty proposals, including a National Rail
// service feed and a UK legislation feed — and `daydream_capabilities` stayed
// empty. Measured 2026-09-17.
//
// The same shape had already cost this engine once: every lead ever proposed
// was rejected for `unknown metrics` until the vocabulary moved out of a
// footnote and into the rule that needed it.
//
// So the audits stop being punctuation-exact. Brackets, backticks and
// surrounding whitespace are FORMATTING the renderer chose, not part of the
// identity of a fact; a model that echoes them back is doing as it was told.
// What a key means is still exact — this normalises the wrapper and nothing
// else, so `intel:4` can never be read as `intel:5`.

/**
 * The key a citation refers to, stripped of the delimiters a pack rendered it
 * inside. Returns '' when there is nothing left, which every caller already
 * treats as "not in the pack".
 *
 * Deliberately NOT a fuzzy match: no case folding, no whitespace collapsing
 * inside the key, no prefix matching. A citation that names a different fact is
 * still a miss, and must still be dropped.
 */
export function citeKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let s = raw.trim();
  // One wrapper is the realistic case ("[F12]", "`F12`"); loop so "[[F12]]"
  // and "`[F12]`" resolve too, bounded because each pass must remove a pair.
  for (let i = 0; i < 4; i++) {
    const next = s
      .replace(/^[[(`'"«]+/, '')
      .replace(/[\])`'"»]+$/, '')
      .trim();
    if (next === s) break;
    s = next;
  }
  // A trailing sentence comma from a model writing prose into a JSON string.
  return s.replace(/[,.;]+$/, '').trim();
}

/**
 * Resolve a list of raw citations against the keys a pack actually laid out.
 * Returns the deduplicated hits in the order given, and the misses as written,
 * so a drop message can quote what the model said rather than what we wish it
 * had said.
 */
export function resolveCites(
  raw: unknown,
  /** A Set of keys or a Map keyed by them — both audits already hold one. */
  packKeys: { has(key: string): boolean },
): { hits: string[]; misses: string[] } {
  const list = Array.isArray(raw) ? raw : [];
  const hits: string[] = [];
  const misses: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const key = citeKey(item);
    if (key && packKeys.has(key)) {
      if (!seen.has(key)) {
        seen.add(key);
        hits.push(key);
      }
    } else {
      misses.push(typeof item === 'string' ? item.trim().slice(0, 60) : String(item).slice(0, 60));
    }
  }
  return { hits, misses };
}
