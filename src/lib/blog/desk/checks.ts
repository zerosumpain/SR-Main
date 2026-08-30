// The deterministic pre-publish checks for the writing desk.
//
// SEVERITY DISCIPLINE — the rule the whole publish gate rests on:
// ONLY deterministic checks may raise 'blocker'. A model's opinion is never a
// blocker, however confident it sounds. The reason is not politeness about
// LLMs: a blocker is the one severity that stops a publish, so the moment a
// non-deterministic lane can raise one, the gate starts refusing to ship posts
// for reasons nobody can reproduce, and the only available fix is to stop
// trusting the gate. Everything in this file is reproducible from the post text
// alone — same input, same findings, same hashes — which is exactly what earns
// it the right to say no. The 'claim' and 'voice' lanes cap at 'review'.
//
// Everything here is PURE and synchronous. No network, no DB, no clock, no
// randomness: the aggregator is run on every keystroke-idle in the editor and
// again server-side before publish, and the two must agree.

import { plainTextFromHtml, readability, countWords } from '$lib/blog/readability';
import { anchorHash } from './anchor';
import type { CheckKind, CheckSeverity, Finding } from './types';

/** The post fields the deterministic checks can see. Deliberately not the DB
 *  row: these checks run against the editor's unsaved draft too. */
export type PostForChecks = {
  title: string;
  excerpt: string;
  slug: string;
  contentHtml: string;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  tags: string[];
};

// --- thresholds -------------------------------------------------------------
// The excerpt is the OG description AND the card copy on /blog. Under 40 chars
// the card looks unfinished; over 200 the social preview truncates mid-word.
const EXCERPT_MIN = 40;
const EXCERPT_MAX = 200;
// Google stops rendering a title somewhere around here. A nit, not a rule.
const TITLE_MAX = 70;
const FRE_FLOOR = 45;
const SENTENCE_WORD_MAX = 60;
// Below this the Flesch score is a single sentence's length wearing a number:
// the words-per-sentence term dominates and a short intro scores "graduate
// reader" for no reason. Not worth a finding.
const MIN_WORDS_FOR_SCORE = 40;

type Draft = {
  kind: CheckKind;
  severity: CheckSeverity;
  /** Rule id. Hashed, never displayed. */
  rule: string;
  /** What makes this occurrence distinct WITHIN the rule. Defaults to
   *  anchorText, and must be overridden whenever anchorText is markup — see
   *  toFinding. */
  key?: string;
  title: string;
  detail: string;
  anchorText: string | null;
};

function toFinding(d: Draft): Finding {
  return {
    kind: d.kind,
    severity: d.severity,
    title: d.title,
    detail: d.detail,
    anchorText: d.anchorText,
    // Two things are folded into the hashed input, both because of the stored
    // unique index (post_id, anchor_hash, kind):
    //
    // 1. The RULE id, because 'title is blank' and 'excerpt is blank' are both
    //    kind 'meta' over an empty anchor. Without it they hash identically and
    //    the upsert keeps whichever one it saw last.
    // 2. A separate `key` for markup anchors, because normaliseAnchor strips
    //    tags — so an `<img src="a.png">` anchor normalises to the EMPTY STRING
    //    and every image in the post would share one key. The key carries the
    //    src (or href) instead, which is the bit that actually identifies it.
    anchorHash: anchorHash(d.kind, `${d.rule}\u0000${d.key ?? d.anchorText ?? ''}`),
  };
}

const blank = (s: string | null | undefined) => !s || !s.trim();

/**
 * Read one attribute out of a tag.
 *
 * The leading-whitespace requirement is load-bearing: `\balt\s*=` also matches
 * the tail of `data-alt=`, because `-` counts as a word boundary, and TipTap
 * emits plenty of `data-*`. Returns null for "no such attribute" and '' for an
 * attribute that is present and empty — checkAltText depends on telling those
 * two apart.
 */
function attr(tag: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = re.exec(tag);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? '';
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// alt text
// ---------------------------------------------------------------------------

/** Everything after the last '/', minus a query string and a file extension. */
function filenameStem(src: string): string {
  const path = src.split(/[?#]/)[0] ?? '';
  const base = path.split('/').pop() ?? '';
  return base.replace(/\.[a-z0-9]{1,5}$/i, '');
}

/** Punctuation-insensitive comparison form, so `IMG_1234` matches "img 1234". */
const loose = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function altRepeatsFilename(alt: string, src: string): boolean {
  const a = loose(alt);
  if (!a) return false;
  const base = (src.split(/[?#]/)[0] ?? '').split('/').pop() ?? '';
  const stem = filenameStem(src);
  if (!stem) return false;
  return a === loose(stem) || a === loose(base) || a === loose(src);
}

export function checkAltText(post: PostForChecks): Finding[] {
  const out: Finding[] = [];
  for (const tag of post.contentHtml.match(/<img\b[^>]*>/gi) ?? []) {
    const alt = attr(tag, 'alt');
    const src = attr(tag, 'src') ?? '';

    if (alt === null) {
      out.push(
        toFinding({
          kind: 'alt-text',
          severity: 'review',
          rule: 'image-alt-missing',
          key: src || tag,
          title: 'Image has no alt attribute',
          detail:
            'A screen reader falls back to reading the filename. Describe what the image shows, or set alt="" if it is purely decorative.',
          anchorText: tag,
        }),
      );
      continue;
    }

    // An explicitly empty alt is the CORRECT answer for a decorative image —
    // it tells a screen reader to skip the image entirely, which is what you
    // want for a rule, a texture or an image whose caption already says
    // everything. Flagging it would train the author to write noise into it,
    // which is strictly worse for the reader than nothing. So the finding is
    // "the attribute is absent" (nobody decided), never "the attribute is
    // empty" (somebody decided).
    if (!alt.trim()) continue;

    if (altRepeatsFilename(alt, src)) {
      out.push(
        toFinding({
          kind: 'alt-text',
          severity: 'review',
          rule: 'image-alt-filename',
          key: src || tag,
          title: 'Alt text is just the filename',
          detail: `"${alt}" repeats the file name, which tells a screen reader nothing it would not already read out. Describe the image instead.`,
          anchorText: tag,
        }),
      );
    }
  }
  return out;
}

export function checkCoverAlt(post: PostForChecks): Finding[] {
  if (blank(post.coverImageUrl) || !blank(post.coverImageAlt)) return [];
  return [
    toFinding({
      kind: 'alt-text',
      severity: 'review',
      rule: 'cover-alt-missing',
      key: post.coverImageUrl ?? '',
      title: 'Cover image has no alt text',
      detail:
        'The cover is the first image on the page and the one the card and the social preview reuse, so it is the one most likely to be read aloud on its own.',
      anchorText: post.coverImageUrl,
    }),
  ];
}

// ---------------------------------------------------------------------------
// metadata
// ---------------------------------------------------------------------------

export function checkMeta(post: PostForChecks): Finding[] {
  const out: Finding[] = [];
  const title = post.title ?? '';
  const excerpt = post.excerpt ?? '';

  if (blank(title)) {
    out.push(
      toFinding({
        kind: 'meta',
        severity: 'blocker',
        rule: 'title-blank',
        title: 'The post has no title',
        detail: 'The title is the page <h1>, the card heading and the OG title. Nothing can publish without it.',
        anchorText: null,
      }),
    );
  } else if (title.length > TITLE_MAX) {
    out.push(
      toFinding({
        kind: 'meta',
        severity: 'nit',
        rule: 'title-long',
        title: `Title is ${title.length} characters`,
        detail: `Search results and the blog card both cut off around ${TITLE_MAX}. The end of this one will not be read.`,
        anchorText: title,
      }),
    );
  }

  if (blank(excerpt)) {
    out.push(
      toFinding({
        kind: 'meta',
        severity: 'blocker',
        rule: 'excerpt-blank',
        title: 'The post has no excerpt',
        detail:
          'The excerpt is the OG description and the card copy. With it blank the social preview falls back to whatever the crawler scrapes, which is usually the nav.',
        anchorText: null,
      }),
    );
  } else if (excerpt.length > EXCERPT_MAX) {
    out.push(
      toFinding({
        kind: 'meta',
        severity: 'review',
        rule: 'excerpt-long',
        title: `Excerpt is ${excerpt.length} characters`,
        detail: `Over ${EXCERPT_MAX} the social preview truncates it mid-sentence.`,
        anchorText: excerpt,
      }),
    );
  } else if (excerpt.length < EXCERPT_MIN) {
    out.push(
      toFinding({
        kind: 'meta',
        severity: 'review',
        rule: 'excerpt-short',
        title: `Excerpt is only ${excerpt.length} characters`,
        detail: `Under ${EXCERPT_MIN} the card reads as a stub. This is the only copy most people see before deciding whether to open the post.`,
        anchorText: excerpt,
      }),
    );
  }

  if (!post.tags || post.tags.filter((t) => !blank(t)).length === 0) {
    out.push(
      toFinding({
        kind: 'meta',
        severity: 'nit',
        rule: 'tags-none',
        title: 'No tags',
        detail: 'Tags drive the /blog filters and the related-posts rail. An untagged post is reachable only from the index.',
        anchorText: null,
      }),
    );
  }

  const slug = post.slug ?? '';
  if (/[A-Z]/.test(slug) || slug.includes('_')) {
    out.push(
      toFinding({
        kind: 'meta',
        severity: 'review',
        rule: 'slug-shape',
        title: 'Slug has uppercase or underscores',
        detail:
          'URLs are compared case-sensitively by most of the web and shared by hand by all of it. Lowercase and hyphens only, and change it before publish — after publish it is a broken link.',
        anchorText: slug,
      }),
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// leftover placeholders
// ---------------------------------------------------------------------------

// Word-boundary anchored, every one of them. An unanchored /todo/i matches
// "todos" and an unanchored /tk/i matches "ATKINS", and a gate that cries wolf
// on ordinary prose is a gate people learn to click past — which costs more
// than the real TODO it was meant to catch.
const PLACEHOLDERS: { rule: string; label: string; re: RegExp }[] = [
  { rule: 'placeholder-todo', label: 'TODO', re: /\bTODO\b/gi },
  { rule: 'placeholder-fixme', label: 'FIXME', re: /\bFIXME\b/gi },
  { rule: 'placeholder-xxx', label: 'XXX', re: /\bXXX\b/gi },
  { rule: 'placeholder-lorem', label: 'lorem ipsum', re: /\blorem\s+ipsum\b/gi },
  // Sub-editor's "to come". Standalone only.
  { rule: 'placeholder-tk', label: 'TK', re: /\bTK\b/gi },
  { rule: 'placeholder-insert-here', label: 'INSERT HERE', re: /\bINSERT\s+HERE\b/gi },
];

/** A locatable window around a match. The bare token is useless as an anchor —
 *  "TODO" appears three times and the editor cannot tell which one a finding
 *  meant — so the surrounding words become both the anchor and the dedupe key. */
function context(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  const body = collapse(text.slice(start, end));
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}

export function checkPlaceholders(post: PostForChecks): Finding[] {
  // plainTextFromHtml drops <pre> and <code>, which is exactly right here: a
  // TODO inside a code sample is the post's subject matter, not a leftover.
  const text = plainTextFromHtml(post.contentHtml);
  const out: Finding[] = [];
  for (const { rule, label, re } of PLACEHOLDERS) {
    // Fresh regex per pass. Draining the loop below to null resets lastIndex,
    // so sharing the module-level literal happens to work TODAY — and stops
    // working the moment anyone adds an early `break` or a cap on the number of
    // findings, at which point lastIndex stays parked and the next call over
    // the same text silently starts halfway through it. Copying costs nothing
    // and takes the module-level mutable state out of the picture entirely.
    const scan = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = scan.exec(text)) !== null) {
      const snippet = context(text, m.index, m[0].length);
      out.push(
        toFinding({
          kind: 'consistency',
          severity: 'blocker',
          rule,
          key: snippet,
          title: `"${label}" left in the body`,
          detail: `A placeholder made it to the publish gate. Found "${m[0]}" in: ${snippet}`,
          anchorText: snippet,
        }),
      );
      // Zero-length matches cannot happen with these patterns, but an empty
      // match would spin forever if one ever did.
      if (m[0].length === 0) scan.lastIndex++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// links
// ---------------------------------------------------------------------------

const isAbsolute = (href: string) => /^(https?:)?\/\//i.test(href);

/** RFC 2606 reserved names. All three exist solely to be placeholders, so a
 *  link to one is never a link the author meant to ship. */
const isReservedExample = (href: string) => /^(https?:)?\/\/(www\.)?example\.(com|org|net)([/:?#]|$)/i.test(href);

const isLocalhost = (href: string) => /^(https?:)?\/\/(localhost|127\.0\.0\.1|\[::1\])([/:?#]|$)/i.test(href);

/** Same link, written two ways? Compare with the protocol and any trailing
 *  slash removed, so "strangeramblings.com/x" reads as the raw form of
 *  "https://strangeramblings.com/x/". */
const urlish = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/^(https?:)?\/\//, '')
    .replace(/\/+$/, '');

export function checkLinks(post: PostForChecks): Finding[] {
  const out: Finding[] = [];
  const anchors = post.contentHtml.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi);

  for (const match of anchors) {
    const tag = match[0];
    const raw = attr(tag, 'href');
    // No href at all is a bookmark target (`<a id="section-2">`), not a broken
    // link. Skipping it is the difference between checking links and checking
    // every anchor element in the document.
    if (raw === null) continue;

    const href = raw.trim();
    const inner = tag.replace(/^<a\b[^>]*>/i, '').replace(/<\/a>$/i, '');
    const text = collapse(plainTextFromHtml(inner));
    const key = `${href}\u0000${text}`;

    const blocker = (rule: string, title: string, detail: string) =>
      out.push(toFinding({ kind: 'link', severity: 'blocker', rule, key, title, detail, anchorText: tag }));

    if (href === '' || href === '#') {
      blocker(
        'link-empty',
        'Link goes nowhere',
        `The href is ${href === '' ? 'empty' : 'just "#"'}, so clicking it does nothing (or jumps to the top of the page). Give it a target or unlink the text.`,
      );
      continue;
    }
    if (/^javascript:/i.test(href)) {
      blocker(
        'link-javascript',
        'javascript: link in the body',
        'The sanitiser strips these on render, so the link is dead on the published page. It is also the shape an XSS payload takes, which is why it never survives.',
      );
      continue;
    }
    if (isLocalhost(href)) {
      blocker(
        'link-localhost',
        'Link points at localhost',
        'This resolves to the reader\'s own machine. It works while drafting and is broken for everybody else.',
      );
      continue;
    }
    if (isReservedExample(href)) {
      blocker('link-example', 'Link points at example.com', 'A reserved placeholder domain that was never meant to ship.');
      continue;
    }

    // Below here the link works. These two are independent facts about it and
    // can both be true of one link, so neither short-circuits the other.
    if (isAbsolute(href) && /^http:\/\//i.test(href)) {
      out.push(
        toFinding({
          kind: 'link',
          severity: 'review',
          rule: 'link-insecure',
          key,
          title: 'External link is http, not https',
          detail: 'Browsers warn on, downgrade or block plain http. If the destination supports https, link to that.',
          anchorText: tag,
        }),
      );
    }

    if (text && urlish(text) === urlish(href)) {
      out.push(
        toFinding({
          kind: 'link',
          severity: 'nit',
          rule: 'link-raw-url',
          key,
          title: 'Link text is the raw URL',
          detail: `"${text}" reads as machinery. Say what is on the other end instead — it also gives a screen reader something better than a URL spelled out character by character.`,
          anchorText: tag,
        }),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// readability
// ---------------------------------------------------------------------------

/** Split on terminal punctuation followed by whitespace — the same boundary
 *  countSentences uses, so a sentence flagged here is one the score counted. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(collapse)
    .filter(Boolean);
}

export function checkReadability(post: PostForChecks): Finding[] {
  const text = plainTextFromHtml(post.contentHtml);
  const scores = readability(text);
  const out: Finding[] = [];

  if (scores.words >= MIN_WORDS_FOR_SCORE && scores.fleschReadingEase < FRE_FLOOR) {
    out.push(
      toFinding({
        kind: 'readability',
        severity: 'nit',
        rule: 'readability-score',
        key: 'post',
        title: `Flesch reading ease ${scores.fleschReadingEase}`,
        detail: `Below ${FRE_FLOOR} reads as ${scores.audience.toLowerCase()}. Usually long sentences rather than long words — check the ones flagged alongside this.`,
        anchorText: null,
      }),
    );
  }

  for (const sentence of splitSentences(text)) {
    const words = countWords(sentence);
    if (words > SENTENCE_WORD_MAX) {
      out.push(
        toFinding({
          kind: 'readability',
          severity: 'nit',
          rule: 'sentence-long',
          title: `A ${words}-word sentence`,
          detail: `Over ${SENTENCE_WORD_MAX} words a reader loses the subject before the verb arrives. Usually there are two sentences in here.`,
          anchorText: sentence,
        }),
      );
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// the aggregator
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<CheckSeverity, number> = { blocker: 0, review: 1, nit: 2 };

export function runDeterministicChecks(post: PostForChecks): Finding[] {
  const all = [
    ...checkMeta(post),
    ...checkPlaceholders(post),
    ...checkLinks(post),
    ...checkAltText(post),
    ...checkCoverAlt(post),
    ...checkReadability(post),
  ];

  // Collapse anything that would collide in the DB anyway. (post_id,
  // anchor_hash, kind) is unique, so two findings sharing a key are not two
  // rows — they are one row written twice, and the panel would show a count
  // the table cannot hold. Two byte-identical <img> tags are the realistic
  // case, and there is nothing in the text to tell them apart with.
  const seen = new Set<string>();
  const deduped = all.filter((f) => {
    const key = `${f.kind}:${f.anchorHash}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Blockers first. Array.prototype.sort is stable (spec-guaranteed since
  // ES2019), so ties keep check order and a re-run over unchanged text returns
  // a deep-equal array — which is what makes the anchor hashes worth having.
  return deduped.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
