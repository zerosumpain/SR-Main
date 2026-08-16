/**
 * What KIND OF MATERIAL a source actually is, and whether it is worth reading.
 *
 * `credibility_type` already answers "how much should I trust the publisher"
 * — ACADEMIC, GOV, NEWS, SOCIAL, WIKI. It does not answer "what is this", and
 * the two are genuinely different questions. A Harvard PDF study and a Harvard
 * events listing are both `academic`/0.85; a YouTube lecture and a TikTok are
 * both `social`. The source list showed the first answer twice and the second
 * never, so a run that found three research papers presented them as
 * indistinguishable from thirty profile pages.
 *
 * Two functions, deliberately separate:
 *
 *  - `classifyMedia` looks only at the source itself — URL, title, snippet. It
 *    is a pure lookup, which is what lets it apply RETROACTIVELY to every run
 *    already in the database without a re-run, a migration or a model call.
 *  - `rankSources` adds what the run learned: how many facts a source actually
 *    produced. That is the part `classifyMedia` cannot know and the part that
 *    separates "this is a paper" from "this paper is why the summary says what
 *    it says".
 *
 * The ordering matters more than it looks. The list was sorted by credibility
 * score, which put six government pages that yielded NOTHING above the two
 * trade-press articles that produced all 32 facts in the report. Sorting by
 * what a source contributed is the fix; the media flag is how you tell at a
 * glance what the thing contributing actually was.
 */

/** Coarse form of the material. Not a trust judgement — see the header. */
export type MediaKind =
  | 'paper'
  | 'preprint'
  | 'report'
  | 'dataset'
  | 'legal'
  | 'video'
  | 'audio'
  | 'slides'
  | 'book'
  | 'news'
  | 'press_release'
  | 'blog'
  | 'forum'
  | 'social'
  | 'profile'
  | 'reference'
  | 'page';

export interface MediaFlag {
  kind: MediaKind;
  /** Uppercase mono tag, matching `credibilityBadge`'s house style. */
  label: string;
  /**
   * 0..1 — how much this FORM of material tends to be worth, before anything
   * is known about what it contributed. Peer-reviewed work and primary data
   * sit high; a directory listing sits low.
   */
  weight: number;
  /** True for the forms worth surfacing on sight. Drives the key-material band. */
  substantial: boolean;
  /** Set when the material is a downloadable document rather than a web page. */
  isDocument: boolean;
}

const KINDS: Record<MediaKind, Omit<MediaFlag, 'kind'>> = {
  paper: { label: 'PAPER', weight: 1, substantial: true, isDocument: true },
  preprint: { label: 'PREPRINT', weight: 0.9, substantial: true, isDocument: true },
  report: { label: 'REPORT', weight: 0.85, substantial: true, isDocument: true },
  dataset: { label: 'DATA', weight: 0.85, substantial: true, isDocument: true },
  legal: { label: 'LEGAL', weight: 0.8, substantial: true, isDocument: true },
  book: { label: 'BOOK', weight: 0.7, substantial: true, isDocument: true },
  slides: { label: 'SLIDES', weight: 0.55, substantial: true, isDocument: true },
  video: { label: 'VIDEO', weight: 0.5, substantial: true, isDocument: false },
  audio: { label: 'AUDIO', weight: 0.5, substantial: true, isDocument: false },
  news: { label: 'ARTICLE', weight: 0.45, substantial: false, isDocument: false },
  // "PRESS RELEASE" overflowed the flag column and collided with the title.
  press_release: { label: 'PRESS', weight: 0.3, substantial: false, isDocument: false },
  blog: { label: 'BLOG', weight: 0.3, substantial: false, isDocument: false },
  reference: { label: 'REFERENCE', weight: 0.35, substantial: false, isDocument: false },
  forum: { label: 'FORUM', weight: 0.2, substantial: false, isDocument: false },
  social: { label: 'POST', weight: 0.15, substantial: false, isDocument: false },
  profile: { label: 'PROFILE', weight: 0.1, substantial: false, isDocument: false },
  page: { label: 'PAGE', weight: 0.25, substantial: false, isDocument: false },
};

/** Publisher hosts whose material is peer-reviewed or archival by default. */
const PAPER_HOSTS = [
  'doi.org',
  'pubmed.ncbi.nlm.nih.gov',
  'ncbi.nlm.nih.gov',
  'sciencedirect.com',
  'springer.com',
  'link.springer.com',
  'nature.com',
  'science.org',
  'jstor.org',
  'wiley.com',
  'onlinelibrary.wiley.com',
  'tandfonline.com',
  'sagepub.com',
  'journals.sagepub.com',
  'acm.org',
  'ieee.org',
  'ieeexplore.ieee.org',
  'plos.org',
  'journals.plos.org',
  'frontiersin.org',
  'mdpi.com',
  'cambridge.org',
  'oup.com',
  'academic.oup.com',
  'bmj.com',
  'thelancet.com',
  'nejm.org',
  'semanticscholar.org',
  'scholar.google.com',
  'researchgate.net',
  'academia.edu',
  'nber.org',
  'ifs.org.uk',
];

const PREPRINT_HOSTS = ['arxiv.org', 'biorxiv.org', 'medrxiv.org', 'ssrn.com', 'papers.ssrn.com', 'osf.io', 'zenodo.org', 'hal.science'];
const VIDEO_HOSTS = ['youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com', 'ted.com', 'twitch.tv'];
const AUDIO_HOSTS = ['podcasts.apple.com', 'open.spotify.com', 'soundcloud.com', 'buzzsprout.com', 'podbean.com'];
const DATA_HOSTS = ['data.gov', 'data.gov.uk', 'ons.gov.uk', 'statista.com', 'kaggle.com', 'ec.europa.eu', 'data.worldbank.org', 'oecd.org', 'explore-education-statistics.service.gov.uk', 'nomisweb.co.uk'];
const LEGAL_HOSTS = ['legislation.gov.uk', 'bailii.org', 'courtlistener.com', 'judiciary.uk', 'caselaw.nationalarchives.gov.uk', 'eur-lex.europa.eu', 'supremecourt.uk'];
const FORUM_HOSTS = ['reddit.com', 'stackoverflow.com', 'stackexchange.com', 'quora.com', 'news.ycombinator.com', 'discourse.org'];
const SOCIAL_HOSTS = ['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'threads.net', 'mastodon.social', 'bsky.app'];
const REFERENCE_HOSTS = ['wikipedia.org', 'wiktionary.org', 'britannica.com', 'wikidata.org', 'investopedia.com'];
const BLOG_HOSTS = ['medium.com', 'substack.com', 'blogspot.com', 'wordpress.com', 'ghost.io', 'dev.to'];
const PRESS_HOSTS = ['businesswire.com', 'prnewswire.com', 'globenewswire.com', 'newswire.com', 'prweb.com', 'einpresswire.com'];
const BOOK_HOSTS = ['books.google.com', 'goodreads.com', 'archive.org', 'openlibrary.org'];

/** Title phrasings that mark scholarly work regardless of where it is hosted. */
const PAPER_TITLE_HINTS = [
  ' et al',
  'journal of ',
  'proceedings of',
  'working paper',
  'discussion paper',
  'white paper',
  'a systematic review',
  'meta-analysis',
  'randomised controlled',
  'randomized controlled',
  'peer-reviewed',
  'doi:',
  'abstract:',
];

const REPORT_TITLE_HINTS = [
  'annual report',
  'technical report',
  'research report',
  'impact assessment',
  'evidence review',
  'consultation response',
  'green paper',
  'command paper',
  'briefing paper',
  'policy paper',
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    // A bare path is still worth matching on — callers pass stored URLs, which
    // are occasionally truncated.
    return url.toLowerCase();
  }
}

/**
 * Exact host, or a subdomain of it. Deliberately NOT a substring test.
 *
 * `includes` looked harmless and classified `ir.huronconsultinggroup.com` as a
 * peer-reviewed paper, because "consultinggr**oup.com**" contains `oup.com`
 * (Oxford University Press). The same trap would make any `wanted.com` a video
 * host via `ted.com`. Suffix matching is the only correct test for a domain.
 */
function hostMatches(host: string, list: string[]): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}

function extensionOf(path: string): string {
  const m = /\.([a-z0-9]{2,5})$/.exec(path);
  return m ? m[1] : '';
}

export interface ClassifyInput {
  url: string;
  title?: string | null;
  snippet?: string | null;
  /** The existing publisher classification, used only as a last resort. */
  credibilityType?: string | null;
}

/**
 * What kind of material this is.
 *
 * Order is significant: the most specific and most reliable signal wins. A file
 * extension beats a host, because `harvard.edu/….pdf` is a document whatever
 * else Harvard publishes; a host beats a title, because titles are written by
 * whoever wrote the page; and `credibility_type` is consulted only when nothing
 * else spoke, since it is answering a different question entirely.
 */
export function classifyMedia(input: ClassifyInput): MediaFlag {
  const url = input.url ?? '';
  const host = hostOf(url);
  const path = pathOf(url);
  const ext = extensionOf(path);
  const title = (input.title ?? '').toLowerCase();
  const haystack = `${title} ${(input.snippet ?? '').toLowerCase()}`;

  const flag = (kind: MediaKind): MediaFlag => ({ kind, ...KINDS[kind] });

  // ── 1. The file itself ────────────────────────────────────────────────────
  if (ext === 'csv' || ext === 'xlsx' || ext === 'xls' || ext === 'ods') return flag('dataset');
  if (ext === 'ppt' || ext === 'pptx') return flag('slides');
  if (ext === 'mp4' || ext === 'mov' || ext === 'webm') return flag('video');
  if (ext === 'mp3' || ext === 'wav' || ext === 'm4a') return flag('audio');
  if (ext === 'epub') return flag('book');
  if (ext === 'pdf') {
    // A PDF is a container, not a genre. Which genre it is comes from where it
    // sits and what it is called — this is the Harvard `leasons_from_leading_
    // cdos.pdf` case, an academic-host PDF that read as an ordinary link.
    if (hostMatches(host, PREPRINT_HOSTS)) return flag('preprint');
    if (hostMatches(host, PAPER_HOSTS) || input.credibilityType === 'academic') return flag('paper');
    if (PAPER_TITLE_HINTS.some((h) => haystack.includes(h))) return flag('paper');
    return flag('report');
  }

  // ── 2. Where it lives ─────────────────────────────────────────────────────
  if (hostMatches(host, PREPRINT_HOSTS)) return flag('preprint');
  if (hostMatches(host, PAPER_HOSTS)) return flag('paper');
  if (hostMatches(host, DATA_HOSTS)) return flag('dataset');
  if (hostMatches(host, LEGAL_HOSTS)) return flag('legal');
  if (hostMatches(host, VIDEO_HOSTS)) return flag('video');
  if (hostMatches(host, AUDIO_HOSTS)) return flag('audio');
  if (hostMatches(host, BOOK_HOSTS)) return flag('book');
  if (hostMatches(host, PRESS_HOSTS)) return flag('press_release');
  if (hostMatches(host, REFERENCE_HOSTS)) return flag('reference');
  if (hostMatches(host, FORUM_HOSTS)) return flag('forum');

  // LinkedIn is two different things on two different paths, and collapsing
  // them to `social` lost the distinction that matters: a profile is a record
  // ABOUT someone, a post is something they said.
  if (host.endsWith('linkedin.com')) {
    if (path.startsWith('/in/') || path.startsWith('/company/')) return flag('profile');
    return flag('social');
  }
  if (hostMatches(host, SOCIAL_HOSTS)) return flag('social');
  if (hostMatches(host, BLOG_HOSTS) || host.startsWith('blog.') || host.includes('.blog.')) {
    return flag('blog');
  }

  // ── 3. What the path says ─────────────────────────────────────────────────
  // `/article/` is deliberately absent: it is the US Department of Defense CMS's
  // URL for a general's biography, and it flagged one as a research paper. Real
  // journals are matched by host above, so the path never needs to guess.
  if (/\/(abs|doi|publication|full)\//.test(path)) return flag('paper');
  if (/press-release|\/press\/|news-release/.test(path)) return flag('press_release');
  if (/\/blog\//.test(path)) return flag('blog');
  if (/\/(news|story|stories)\//.test(path)) return flag('news');
  // A date in the path is how nearly every news CMS builds a permalink, and it
  // is the difference between "an article about the Treasury's data strategy"
  // and "a page". Checked after the scholarly hosts, which are matched by host
  // and so cannot be swallowed by this.
  if (/\/(19|20)\d{2}\/\d{1,2}\/\d{1,2}\//.test(path)) return flag('news');

  // ── 4. What it calls itself ───────────────────────────────────────────────
  if (PAPER_TITLE_HINTS.some((h) => haystack.includes(h))) return flag('paper');
  if (REPORT_TITLE_HINTS.some((h) => haystack.includes(h))) return flag('report');

  // ── 5. Fall back on the publisher classification ──────────────────────────
  switch (input.credibilityType) {
    case 'academic':
      return flag('paper');
    case 'major_news':
    case 'news':
      return flag('news');
    case 'blog':
      return flag('blog');
    case 'social':
      return flag('social');
    case 'wiki':
      return flag('reference');
    default:
      return flag('page');
  }
}

export interface SourceRow {
  id: string;
  url: string;
  title: string | null;
  domain: string | null;
  snippet?: string | null;
  credibilityScore: number | null;
  credibilityType: string | null;
  /** Facts this source produced in the run. The contribution signal. */
  factCount?: number;
  /**
   * How the run came by this source. `'cited'` means the answer names it.
   *
   * A grounded `instant` run extracts no facts at all, so contribution — the
   * signal that normally decides what mattered — is zero for everything it
   * read. Without this, the six pages an answer was built on all landed under
   * "gathered, but nothing in the report rests on them", which is the exact
   * opposite of the truth.
   */
  category?: string | null;
}

export interface RankedSource extends SourceRow {
  media: MediaFlag;
  factCount: number;
  /** 0..1 blend of contribution, form and publisher trust. Drives the order. */
  interest: number;
  /**
   * Why this source is flagged, in the user's words. A badge with no reason is
   * a decoration; the whole complaint was that key material was not called out,
   * so when it is, the page has to say what made it key.
   */
  reasons: string[];
  /** In the band worth reading first. */
  keyMaterial: boolean;
}

/**
 * Order the sources by what they are worth, and say why.
 *
 * Contribution is weighted hardest (0.55) because it is the only signal derived
 * from this run rather than from the URL: a source that produced twelve facts
 * demonstrably shaped the answer. Form (0.3) is what catches the paper that was
 * read but yielded few discrete facts. Publisher trust (0.15) only breaks ties
 * — it was the sole sort key before, and on its own it ranked six pages that
 * contributed nothing above the two that carried the entire report.
 */
export function rankSources(rows: SourceRow[]): RankedSource[] {
  const maxFacts = Math.max(1, ...rows.map((r) => r.factCount ?? 0));

  const ranked = rows.map((row): RankedSource => {
    const media = classifyMedia({
      url: row.url,
      title: row.title,
      snippet: row.snippet,
      credibilityType: row.credibilityType,
    });
    const factCount = row.factCount ?? 0;
    const cited = row.category === 'cited';
    // sqrt so the difference between 0 and 3 facts counts for more than the
    // difference between 17 and 20 — the first is "did this matter at all".
    const contribution = Math.sqrt(factCount / maxFacts);
    const trust = row.credibilityScore ?? 0.5;
    // A cited source has demonstrably shaped the answer, which is what
    // `contribution` measures on the tiers that extract facts. Standing it in
    // at full weight keeps one ranking rule across every tier.
    const interest = (cited ? 1 : contribution) * 0.55 + media.weight * 0.3 + trust * 0.15;

    const reasons: string[] = [];
    if (cited) reasons.push('the answer cites it');
    if (factCount > 0) {
      reasons.push(`${factCount} ${factCount === 1 ? 'fact' : 'facts'} in the report`);
    }
    if (media.substantial) {
      reasons.push(media.kind === 'dataset' ? 'primary data' : `${media.label.toLowerCase()}`);
    }
    if (trust >= 0.85) reasons.push('authoritative publisher');

    return {
      ...row,
      media,
      factCount,
      interest: Number(interest.toFixed(4)),
      reasons,
      // Three routes in, and each catches something the others miss: a source
      // the answer names, one that demonstrably fed the report, or one that is
      // the kind of material worth a look regardless — the trade-press article
      // nobody would rank, or the paper found late and never mined.
      keyMaterial: cited || factCount > 0 || media.substantial,
    };
  });

  return ranked.sort(
    (a, b) =>
      Number(b.keyMaterial) - Number(a.keyMaterial) ||
      b.interest - a.interest ||
      (a.title ?? a.url).localeCompare(b.title ?? b.url),
  );
}

/** Counts by media kind, largest first — the source-mix chart's series. */
export function mediaMix(ranked: RankedSource[]): { kind: MediaKind; label: string; count: number; facts: number }[] {
  const byKind = new Map<MediaKind, { count: number; facts: number }>();
  for (const r of ranked) {
    const cur = byKind.get(r.media.kind) ?? { count: 0, facts: 0 };
    cur.count += 1;
    cur.facts += r.factCount;
    byKind.set(r.media.kind, cur);
  }
  return [...byKind.entries()]
    .map(([kind, v]) => ({ kind, label: KINDS[kind].label, ...v }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
