// Stable anchor keys for checklist findings.
//
// BROWSER-SAFE ON PURPOSE. The editor computes the same key client-side to line
// a finding up with the text under the cursor, so both sides must agree byte
// for byte — which means one implementation, imported by both. That rules out
// node:crypto: importing it here drags a polyfill into the client bundle at
// best and breaks it at worst. FNV-1a 32-bit is a dozen lines and needs
// nothing, so there is no reason to reach for a real digest.
//
// And a real digest is not what this is. The hash is a DEDUPE KEY: it is the
// (post_id, anchor_hash, kind) unique index on blog_checklist_items, so its
// only job is to let a re-run update a finding in place instead of duplicating
// it. It is never a security boundary — nothing authorises off it, and a
// collision costs one merged checklist row. Do not grow a trust decision on top
// of it; if you need one, that is a different function in a server-only module.

/**
 * Reduce a snippet to the form the hash is taken over.
 *
 * Tags are stripped BEFORE entities are decoded, and the order is load-bearing:
 * `&lt;b&gt;` is literal text the author typed and has to survive, but decoding
 * first turns it into `<b>` and the tag stripper then eats it.
 */
export function normaliseAnchor(text: string): string {
  if (!text) return '';
  return decodeEntities(text.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The idempotency key for one finding.
 *
 * `kind` is mixed into the hashed input rather than concatenated onto the
 * output so the same sentence flagged by two lanes gets two keys. The NUL
 * separator stops the obvious ambiguity: without it ('link', 'ab') and
 * ('lin', 'kab') hash identically.
 */
export function anchorHash(kind: string, text: string): string {
  return fnv1a32(`${kind}\u0000${normaliseAnchor(text)}`);
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a, 32-bit, as 8 lowercase hex chars. Both bytes of every UTF-16 code
 *  unit are folded in unconditionally — skipping the high byte for ASCII would
 *  be marginally faster and would make a two-byte character collide with the
 *  one-byte character sharing its low byte, which is a silly way to lose a
 *  finding. `Math.imul` keeps the multiply in 32-bit; a plain `*` loses the low
 *  bits once the product passes 2^53, and the low bits are the whole point. */
function fnv1a32(input: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    const unit = input.charCodeAt(i);
    hash = Math.imul(hash ^ (unit & 0xff), FNV_PRIME);
    hash = Math.imul(hash ^ ((unit >>> 8) & 0xff), FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Decode the entities a rich-text editor actually emits.
 *
 * The numeric ones are the whole reason this exists. TipTap writes apostrophes
 * as `&#39;`, and leaving those encoded corrupts every measurement taken over
 * the text at once: `I&#39;m` stops reading as a contraction, and the trailing
 * semicolon counts as punctuation nobody typed. One post measured 0
 * contractions and 66 semicolons per 1,000 words purely from this — a
 * completely different writer from the one who wrote it. An anchor key computed
 * over undecoded text has the same disease more quietly: the editor decodes on
 * the way to the DOM, so client and server would key the same sentence
 * differently and every finding would look new on every run.
 *
 * $lib/blog/readability keeps its own private copy of this. Duplicated rather
 * than shared because that one is not exported and this module has to stay
 * standalone for the client bundle. If a third copy appears, hoist it.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&(?:lsquo|rsquo);/g, "'")
    .replace(/&(?:ldquo|rdquo);/g, '"')
    .replace(/&(?:mdash|ndash);/g, '-')
    .replace(/&hellip;/g, '...')
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    // &amp; last, so "&amp;#39;" — an author writing ABOUT the entity — does not
    // become an apostrophe.
    .replace(/&amp;/g, '&');
}

function safeCodePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}
