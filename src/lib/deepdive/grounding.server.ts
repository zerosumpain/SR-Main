/**
 * Turning a grounded answer's citations into rows the rest of the dashboard
 * already knows how to render.
 *
 * The point is reuse, not a new surface. Once a citation is a `source` row it
 * gets the media flag, the credibility badge, the ranking, the mix chart and
 * the "Keep in Drive" button for free — all of which already exist and none of
 * which need to know that this run never ran a Tavily search.
 */
import { db } from '$lib/db';
import { sources as sourcesTable } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { classifyDomain } from './credibility';
import { isRedirectCitation, type Citation } from './grounding';

const REDIRECT_TIMEOUT_MS = 8_000;

/**
 * Phase number recorded against a cited source.
 *
 * Zero, because no phase gathered it. Phase 1 is lead generation and phase 2 is
 * extraction; a citation arrived with the answer rather than being sought, and
 * filing it under a phase that never ran would make the frontier view lie.
 */
const CITED_PHASE = 0;

/** `source.category` marking a row the answer cited. Read by `rankSources`. */
const CITED_CATEGORY = 'cited';

/**
 * Follow a Google grounding redirect to the page it points at.
 *
 * Never throws and never leaves the caller worse off: on any failure the
 * original URL comes back, so a redirect that has expired still produces a row
 * rather than silently dropping a source the answer actually rested on.
 */
export async function resolveCitationUrl(url: string): Promise<string> {
  if (!isRedirectCitation(url)) return url;
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(REDIRECT_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; strangeramblings-research/1.0)' },
    });
    return res.url && /^https?:\/\//i.test(res.url) ? res.url : url;
  } catch {
    return url;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * A readable title from the URL, for the common case of having none.
 *
 * The Codex route sends no title at all and OpenRouter sends the HOST rather
 * than the page title, so falling back to the domain put three rows reading
 * "nodejs.org" next to each other with nothing to tell them apart. The path is
 * the only thing that distinguishes them, and it usually reads well:
 * `/en/blog/release/v26.7.0` becomes "Release v26.7.0".
 */
export function titleFromUrl(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const segments = path.split('/').filter(Boolean);
  // A bare host has no path to describe it; the renderer's domain fallback is
  // then the honest answer rather than an invented one.
  if (!segments.length) return null;
  // Trailing slugs carry the meaning; take the last two so a versioned release
  // page keeps the word "release" alongside the version.
  const words = segments
    .slice(-2)
    .join(' ')
    .replace(/\.(html?|php|aspx?|pdf)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words || words.length < 3) return null;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Whether a provider's "title" is really just the host wearing a title's
 * clothes.
 *
 * OpenRouter's grounding annotations put the site name here — `python.org`
 * against a domain of `www.python.org` — so a plain inequality test let it
 * through and produced two rows both titled "python.org". Anything that is a
 * bare hostname, whether or not it matches this row's domain exactly, tells the
 * reader nothing the domain column is not already showing.
 */
export function isHostLikeTitle(title: string, domain: string): boolean {
  const t = title.trim().toLowerCase().replace(/^www\./, '');
  if (!t) return true;
  if (t === domain.toLowerCase().replace(/^www\./, '')) return true;
  // No spaces and a dotted final segment of 2+ letters: that is a hostname, not
  // a headline. A real title with a domain in it ("Why python.org moved") has
  // spaces and survives.
  return !/\s/.test(t) && /\.[a-z]{2,}$/.test(t);
}

export interface RecordedCitations {
  stored: number;
  /** Resolved URLs, in the order they were cited. */
  urls: string[];
}

/**
 * Store a grounded answer's citations as this session's sources.
 *
 * Redirects are resolved in parallel — there are a handful of citations, not a
 * crawl — and duplicates are dropped, because a model that reads the same page
 * twice cited one source, not two.
 */
export async function recordCitations(
  sessionId: string,
  citations: Citation[],
): Promise<RecordedCitations> {
  if (!citations.length) return { stored: 0, urls: [] };

  const resolved = await Promise.all(
    citations.map(async (c) => ({ ...c, url: await resolveCitationUrl(c.url) })),
  );

  // De-duplicate within this batch first, then against what the session already
  // has — re-running a grounded answer on the same session must not double the
  // source list.
  const byUrl = new Map<string, Citation>();
  for (const c of resolved) if (!byUrl.has(c.url)) byUrl.set(c.url, c);

  const urls = [...byUrl.keys()];
  const existing = new Set(
    (
      await db
        .select({ url: sourcesTable.url })
        .from(sourcesTable)
        .where(and(eq(sourcesTable.sessionId, sessionId), inArray(sourcesTable.url, urls)))
    ).map((r) => r.url),
  );

  const rows = urls
    .filter((u) => !existing.has(u))
    .map((url) => {
      const domain = hostOf(url);
      const { score, type } = classifyDomain(domain);
      const c = byUrl.get(url)!;
      return {
        sessionId,
        url,
        // A provider title only when it says more than the host does; otherwise
        // the path, which is the only thing separating three pages on the same
        // site. See `titleFromUrl`.
        title: c.title && !isHostLikeTitle(c.title, domain) ? c.title : titleFromUrl(url),
        domain,
        // Marks these as sources the ANSWER names rather than pages a phase
        // gathered — which is what puts them in the "worth reading" band even
        // though an instant run extracts no facts. See `rankSources`.
        category: CITED_CATEGORY,
        phase: CITED_PHASE,
        credibilityScore: score,
        credibilityType: type,
      };
    });

  if (rows.length) await db.insert(sourcesTable).values(rows);
  return { stored: rows.length, urls };
}
