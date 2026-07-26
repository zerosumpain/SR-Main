// Entity mentions in jkai replies.
//
// When jkai says "IBCA's Data Strategy is owned by John Kelly", those three
// names are entities the intel graph already knows a great deal about. This
// turns each first mention into a hoverable reference that opens a card of what
// the graph holds — summary, type, connections, source notes — without leaving
// the conversation.
//
// Deliberately built on the same string-rewriting approach as citation-linkify:
// it runs over ALREADY-SANITISED chat HTML as a tag/text token stream, so it is
// SSR-safe (no DOMParser) and cannot introduce markup the sanitiser didn't
// already permit. The only attributes injected are a fixed class and a
// data-attribute holding an entity id.
//
// It must run AFTER citation linkification, and it never rewrites inside an
// existing <a>, so a source citation always wins over an entity mention.

export interface EntityMentionTarget {
  id: string;
  name: string;
  typeName: string;
  /** Alternative strings this entity is written as (acronyms, expansions). */
  aliases?: string[];
}

/**
 * Names below this length only match case-sensitively. "IBCA" and "DfE" are
 * safe as exact-case acronyms; a four-letter lowercase word is not.
 */
const SHORT_NAME_LEN = 5;

/**
 * Words too common to link on their own, whatever the graph thinks. Without
 * this, an entity literally named "Data" or "Beta" (both exist in production —
 * `Beta` and `Alpha` were extracted as process_step entities) would linkify
 * every occurrence of an ordinary English word in every reply.
 */
const BANNED_ANCHORS = new Set([
  'data', 'alpha', 'beta', 'discovery', 'live', 'team', 'group', 'project',
  'strategy', 'policy', 'system', 'service', 'board', 'panel', 'review',
  'report', 'plan', 'model', 'risk', 'role', 'user', 'users', 'staff',
  'jen', 'liz', 'glenn', 'chris', 'john', 'katie',
]);

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9]/.test(ch);
}

/** True when the anchor is all-caps (or caps with digits) — an acronym. */
export function isAcronymAnchor(anchor: string): boolean {
  return /^[A-Z][A-Za-z0-9&.-]*$/.test(anchor) && anchor === anchor.toUpperCase() && /[A-Z]{2,}/.test(anchor);
}

/**
 * Whether an anchor is specific enough to link. Short or common strings are
 * rejected outright; mixed-case short names (DfE) survive because they will be
 * matched case-sensitively.
 */
export function isUsableAnchor(anchor: string): boolean {
  const trimmed = anchor.trim();
  if (trimmed.length < 3) return false;
  if (BANNED_ANCHORS.has(trimmed.toLowerCase())) return false;
  // A multi-word name is specific by construction.
  if (/\s/.test(trimmed)) return true;
  if (trimmed.length >= SHORT_NAME_LEN) return true;
  // Short single words must carry distinctive capitalisation.
  return /[A-Z]/.test(trimmed) && trimmed !== trimmed.toLowerCase();
}

/** Anchors for one entity, most specific first. */
export function anchorsFor(target: EntityMentionTarget): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [target.name, ...(target.aliases ?? [])]) {
    const a = (raw ?? '').trim();
    if (!a || !isUsableAnchor(a)) continue;
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  // Longest first, so "IBCA Data Strategy" beats "IBCA" at the same position.
  return out.sort((a, b) => b.length - a.length);
}

/**
 * Earliest word-bounded occurrence of `needle` in `haystack`, or -1.
 *
 * Case sensitivity depends on the anchor: acronyms and short mixed-case names
 * must match exactly, so "DfE" does not fire on "dfe" inside a URL and "IBCA"
 * does not fire on the word "ibca" in a code block. Longer names match
 * case-insensitively, because prose legitimately varies their capitalisation.
 */
export function findAnchor(haystack: string, needle: string): number {
  const exact = isAcronymAnchor(needle) || needle.length < SHORT_NAME_LEN;
  let hay = haystack;
  let nee = needle;
  if (!exact) {
    const lowered = haystack.toLowerCase();
    // toLowerCase can CHANGE LENGTH for a few characters (Turkish dotted I,
    // for one), and the match index is applied back to the ORIGINAL string —
    // so a length change would slice the wrong span. Fall back to an
    // exact-case search rather than risk mangling the text.
    if (lowered.length === haystack.length) {
      hay = lowered;
      nee = needle.toLowerCase();
    }
  }

  let from = 0;
  for (;;) {
    const at = hay.indexOf(nee, from);
    if (at < 0) return -1;
    const before = at > 0 ? haystack[at - 1] : undefined;
    const after = at + nee.length < haystack.length ? haystack[at + nee.length] : undefined;
    if (!isWordChar(before) && !isWordChar(after)) return at;
    from = at + 1;
  }
}

const OPEN_A = /^<a(\s|>)/i;
const CLOSE_A = /^<\/a\s*>/i;
const OPEN_CODE = /^<(code|pre)(\s|>)/i;
const CLOSE_CODE = /^<\/(code|pre)\s*>/i;

export interface LinkifyEntitiesResult {
  html: string;
  /** Ids that were actually linked, so the caller can preload just those cards. */
  linked: string[];
}

/**
 * Wrap the first in-prose mention of each entity in a hoverable reference.
 *
 * Each entity links at most once per message — repeating the same underline on
 * every occurrence turns a reply into a wall of links and adds nothing.
 */
export function linkifyEntities(
  html: string,
  targets: EntityMentionTarget[],
  opts: { maxLinks?: number } = {},
): LinkifyEntitiesResult {
  const maxLinks = opts.maxLinks ?? 40;
  if (!html || !targets.length) return { html, linked: [] };

  // Cheap pre-filter: only entities whose name appears somewhere in the HTML at
  // all are worth putting through the positional pass. With hundreds of
  // entities in the graph and a short reply, this discards nearly all of them
  // for the cost of one indexOf each.
  const lower = html.toLowerCase();
  const candidates = targets
    .map((t) => ({ target: t, anchors: anchorsFor(t) }))
    .filter((c) => c.anchors.length && c.anchors.some((a) => lower.includes(a.toLowerCase())));

  if (!candidates.length) return { html, linked: [] };

  const remaining = candidates.slice();
  const linked: string[] = [];

  const tokens = html.split(/(<[^>]+>)/);
  let anchorDepth = 0;
  let codeDepth = 0;

  const out = tokens.map((tok) => {
    if (tok.startsWith('<')) {
      if (OPEN_A.test(tok)) anchorDepth++;
      else if (CLOSE_A.test(tok)) anchorDepth = Math.max(0, anchorDepth - 1);
      else if (OPEN_CODE.test(tok)) codeDepth++;
      else if (CLOSE_CODE.test(tok)) codeDepth = Math.max(0, codeDepth - 1);
      return tok;
    }
    // Never rewrite inside a link (a citation already claimed it) or inside
    // code, where an entity name is a literal, not a reference.
    if (anchorDepth > 0 || codeDepth > 0 || !remaining.length || !tok) return tok;
    if (linked.length >= maxLinks) return tok;
    return rewriteRun(tok, remaining, linked, maxLinks);
  });

  return { html: out.join(''), linked };
}

function rewriteRun(
  text: string,
  remaining: Array<{ target: EntityMentionTarget; anchors: string[] }>,
  linked: string[],
  maxLinks: number,
): string {
  let result = '';
  let rest = text;

  for (;;) {
    if (!remaining.length || linked.length >= maxLinks) break;

    let best: { at: number; len: number; idx: number } | null = null;
    for (let i = 0; i < remaining.length; i++) {
      for (const anchor of remaining[i].anchors) {
        const at = findAnchor(rest, anchor);
        if (at < 0) continue;
        // Earliest position wins; at the same position the longer (more
        // specific) anchor wins.
        if (!best || at < best.at || (at === best.at && anchor.length > best.len)) {
          best = { at, len: anchor.length, idx: i };
        }
      }
    }
    if (!best) break;

    const entry = remaining[best.idx];
    const matchText = rest.slice(best.at, best.at + best.len);
    result += rest.slice(0, best.at);
    result +=
      `<a class="entity-mention" role="button" tabindex="0"` +
      ` data-entity-id="${escapeAttr(entry.target.id)}"` +
      ` data-entity-type="${escapeAttr(entry.target.typeName)}">${matchText}</a>`;
    rest = rest.slice(best.at + best.len);
    linked.push(entry.target.id);
    remaining.splice(best.idx, 1);
  }

  return result + rest;
}

/** Entity ids and type names are internal, but never interpolate unescaped. */
function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
