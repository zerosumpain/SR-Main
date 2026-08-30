/**
 * Reader comments — validation and spam triage.
 *
 * Pure and dependency-free so it runs identically in the browser (to give the
 * commenter the same message before they submit) and on the server (which is
 * the only place the answer counts). The endpoint must never trust the client
 * half; it exists to save a round trip, not to replace the check.
 *
 * Design constraints worth stating, because they are the whole feature:
 *
 *  - Comments are HELD by default. Nothing a stranger types is visible until
 *    the owner admits it. On a site with no captcha that default IS the
 *    security model — the worst case of a spam flood becomes a full moderation
 *    queue rather than a defaced article.
 *  - No email address is collected, and no raw IP is stored. A name and a body
 *    is everything a "subtle" comment feature needs, and every field beyond
 *    that is a liability with no reader benefit.
 *  - The body is stored and rendered as PLAIN TEXT. There is no markdown, no
 *    HTML and no auto-linking. Auto-linking is what makes a comment box worth
 *    spamming; without it the payoff for a link-dropper is zero, which is a
 *    better filter than any heuristic below.
 */

export const MAX_NAME_LENGTH = 60;
export const MAX_BODY_LENGTH = 4000;
export const MIN_BODY_LENGTH = 2;

export type CommentInput = {
  authorName: string;
  body: string;
  /**
   * Honeypot. A real form leaves this empty because the field is hidden from
   * people; a naive bot fills every input it finds. Cheap, silent, and it costs
   * a reader nothing — unlike a captcha.
   */
  website?: string;
};

export type ValidComment = {
  authorName: string;
  body: string;
  /** True when the heuristics below think this is junk. It is still STORED —
   *  as `status: 'spam'` — so the owner can see the volume and correct a
   *  false positive, rather than the endpoint silently discarding a real
   *  reader's comment. */
  spam: boolean;
  spamReasons: string[];
};

export type CommentValidation =
  | { ok: true; value: ValidComment }
  | { ok: false; error: string };

/** Collapse whitespace and strip control characters. */
function tidy(value: string): string {
  return value
    // Strip C0/C1 control characters, written as escapes deliberately:
    // literal control bytes in a source file are invisible in review.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    // Three or more blank lines is someone padding, not paragraphing.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Two constants, not one. A /g regex carries `lastIndex` BETWEEN `.test()`
// calls, so a single shared global pattern answers false on every other
// call -- here that would have meant a name which is plainly a URL passing
// the check half the time. `.match()` needs the /g; `.test()` must not have it.
// The alternation also has to CONSUME the whole URL rather than just anchor
// on it: `https?://|www\.` matched `https://www.example.com` twice, so one
// perfectly ordinary link tripped the two-or-more-links rule. A test caught it.
const URL_MATCH_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;
const URL_TEST_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+/i;

/**
 * Spam heuristics.
 *
 * Deliberately few and deliberately blunt. Every rule here has a false-positive
 * mode, which is why the verdict routes a comment to the `spam` queue rather
 * than rejecting it outright — a rejection tells the sender exactly which rule
 * to work around, and tells a misjudged reader nothing at all.
 */
export function spamSignals(authorName: string, body: string): string[] {
  const reasons: string[] = [];
  const links = body.match(URL_MATCH_RE)?.length ?? 0;

  if (links >= 2) reasons.push('two or more links');
  // A short comment that is mostly a link is the classic drive-by.
  if (links >= 1 && body.length < 120) reasons.push('short comment built around a link');

  const letters = body.replace(/[^a-z]/gi, '');
  if (letters.length >= 24) {
    const upper = body.replace(/[^A-Z]/g, '').length;
    if (upper / letters.length > 0.6) reasons.push('mostly capitals');
  }

  // 'aaaaaaaa', '!!!!!!!!' — a run this long is never prose.
  if (/(.)\1{9,}/.test(body)) reasons.push('long repeated character run');

  // A name that is itself a URL or an email is a bot filling the wrong field.
  if (URL_TEST_RE.test(authorName) || /@/.test(authorName)) reasons.push('name looks like a URL or address');

  if (/\b(viagra|casino|crypto ?giveaway|forex|seo services|buy backlinks)\b/i.test(body)) {
    reasons.push('known spam vocabulary');
  }

  return reasons;
}

export function validateComment(raw: unknown): CommentValidation {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Missing comment.' };

  const input = raw as Partial<CommentInput>;

  // The honeypot. Answer as if it succeeded elsewhere — the caller turns this
  // into a silent 204 so a bot learns nothing from the response.
  if (typeof input.website === 'string' && input.website.trim() !== '') {
    return { ok: false, error: 'honeypot' };
  }

  if (typeof input.authorName !== 'string' || typeof input.body !== 'string') {
    return { ok: false, error: 'A name and a comment are both required.' };
  }

  const authorName = tidy(input.authorName);
  const body = tidy(input.body);

  if (authorName.length < 1) return { ok: false, error: 'Please add a name.' };
  if (authorName.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Names are limited to ${MAX_NAME_LENGTH} characters.` };
  }
  if (body.length < MIN_BODY_LENGTH) return { ok: false, error: 'Please write a comment.' };
  if (body.length > MAX_BODY_LENGTH) {
    return { ok: false, error: `Comments are limited to ${MAX_BODY_LENGTH} characters.` };
  }

  const spamReasons = spamSignals(authorName, body);

  return {
    ok: true,
    value: { authorName, body, spam: spamReasons.length > 0, spamReasons },
  };
}

/** What a reader is allowed to see about a comment. Note what is absent:
 *  no author hash, no moderation state, no timestamps beyond the display date. */
export type PublicComment = {
  id: number;
  parentId: number | null;
  authorName: string;
  body: string;
  createdAt: string;
};
