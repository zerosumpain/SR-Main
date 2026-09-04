// Domains we treat as reputable for blog citation purposes, and how strongly a
// UK source is preferred over an equally reputable one somewhere else.
// Suffix heuristics (.gov, .edu) cover the tail.

const REPUTABLE_HOSTS = new Set([
  // News wires & broadsheets
  'bbc.co.uk', 'bbc.com', 'reuters.com', 'apnews.com', 'ft.com',
  'theguardian.com', 'nytimes.com', 'washingtonpost.com', 'economist.com',
  'wsj.com', 'bloomberg.com', 'cnn.com', 'cnbc.com', 'npr.org',
  'aljazeera.com', 'lemonde.fr', 'spiegel.de', 'thetimes.co.uk',
  'telegraph.co.uk', 'independent.co.uk', 'latimes.com', 'usatoday.com',
  'time.com', 'theatlantic.com', 'newyorker.com', 'pbs.org',
  // Tech press
  'techcrunch.com', 'theverge.com', 'wired.com', 'arstechnica.com',
  'engadget.com', 'venturebeat.com', 'theinformation.com', 'axios.com',
  'protocol.com', 'restofworld.org', 'theregister.com',
  // UK official / statistical
  'ons.gov.uk', 'parliament.uk', 'nhs.uk', 'gov.uk',
  // International official / statistical
  'ec.europa.eu', 'imf.org', 'worldbank.org', 'oecd.org', 'un.org',
  'eea.europa.eu', 'europa.eu',
  // Health & science
  'who.int', 'nih.gov', 'cdc.gov', 'fda.gov', 'ema.europa.eu',
  'nature.com', 'science.org', 'sciencemag.org', 'cell.com',
  'thelancet.com', 'nejm.org', 'bmj.com', 'pnas.org',
  'pubmed.ncbi.nlm.nih.gov', 'arxiv.org', 'semanticscholar.org',
  // Reference
  'britannica.com', 'oed.com', 'oxfordreference.com',
  // Climate / science aggregators
  'ipcc.ch', 'noaa.gov', 'nasa.gov', 'esa.int', 'metoffice.gov.uk',
  // Industry / trade press for tech & finance
  'sec.gov', 'reutersagency.com', 'morningstar.com',
]);

const REPUTABLE_SUFFIXES = ['.gov', '.gov.uk', '.edu', '.ac.uk', '.gov.au', '.gc.ca'];

/**
 * UK sources, listed because the reputable set alone is not enough to prefer
 * them.
 *
 * WHY THIS EXISTS. The reputable bonus used to be a flat +1, so an ONS page and
 * a Washington Post page arrived at the ranker on equal footing and Tavily's
 * own relevance broke the tie. Tavily's relevance is US-weighted, so the tie
 * broke the same way nearly every time and a post written in Britain cited
 * American sources for British facts — US federal agencies for statistics the
 * ONS publishes, US outlets for events covered here first.
 *
 * The fix is a ranking preference rather than an `include_domains` allow-list,
 * matching how `$lib/deepdive/scope` handles the same problem: a thin allow-list
 * starves the search when the best source genuinely is somewhere else, whereas
 * a bonus only decides ties. A US source that is clearly more relevant still
 * wins, which is the behaviour you want when the subject IS American.
 *
 * Hosts here are the ones a `.uk` suffix cannot catch — British institutions on
 * a .com/.org, and the two big science journals published from London.
 */
const UK_HOSTS = new Set([
  // Broadcast & press
  'bbc.co.uk', 'bbc.com', 'ft.com', 'theguardian.com', 'thetimes.co.uk',
  'telegraph.co.uk', 'independent.co.uk', 'economist.com', 'inews.co.uk',
  'standard.co.uk', 'skynews.com', 'news.sky.com', 'channel4.com',
  'thetimes.com', 'observer.co.uk', 'bigissue.com', 'newstatesman.com',
  'prospectmagazine.co.uk', 'spectator.co.uk',
  // Official, statistical and regulatory
  'ons.gov.uk', 'parliament.uk', 'nhs.uk', 'gov.uk', 'legislation.gov.uk',
  'bankofengland.co.uk', 'nao.org.uk', 'ofcom.org.uk', 'ofgem.gov.uk',
  'ofsted.gov.uk', 'metoffice.gov.uk', 'ordnancesurvey.co.uk',
  'nationalarchives.gov.uk', 'statistics.gov.uk', 'ukhsa.gov.uk',
  'hse.gov.uk', 'ico.org.uk', 'fca.org.uk', 'cqc.org.uk',
  // Research, learned societies and the big UK-published journals
  'thelancet.com', 'bmj.com', 'nature.com', 'royalsociety.org',
  'britishmuseum.org', 'ifs.org.uk', 'kingsfund.org.uk', 'resolutionfoundation.org',
  'jrf.org.uk', 'nesta.org.uk', 'turing.ac.uk', 'ukri.org', 'jisc.ac.uk',
  'wellcome.org', 'nuffieldfoundation.org', 'instituteforgovernment.org.uk',
]);

/** Suffixes that make a host British without needing to be listed. */
const UK_SUFFIXES = ['.uk', '.scot', '.wales', '.cymru', '.london'];

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isReputable(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  if (REPUTABLE_HOSTS.has(host)) return true;
  for (const suffix of REPUTABLE_SUFFIXES) {
    if (host.endsWith(suffix)) return true;
  }
  return false;
}

/** True for a source published in the UK. */
export function isUkSource(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  if (UK_HOSTS.has(host)) return true;
  for (const suffix of UK_SUFFIXES) {
    if (host === suffix.slice(1) || host.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * Academic and research sources.
 *
 * `.ac.uk` is the one that matters most here — John's stated preference is UK
 * academics first — but the flag is about being academic, not about being
 * British: the two are scored separately below so a UK university outranks a US
 * one, and a US university still outranks a newspaper.
 *
 * The named hosts are the UK research bodies a suffix cannot catch: institutes
 * and funders on `.org`/`.org.uk` that publish primary research, plus the two
 * big repositories. Journals stay OUT of this list on purpose — `nature.com`
 * and `thelancet.com` are publishers, and treating a publisher's own page as
 * academic would rank a paywalled abstract above the university that wrote it.
 */
const ACADEMIC_HOSTS = new Set([
  // UK research institutes and funders
  'turing.ac.uk', 'ukri.org', 'jisc.ac.uk', 'royalsociety.org', 'britac.ac.uk',
  'ifs.org.uk', 'niesr.ac.uk', 'kingsfund.org.uk', 'nuffieldfoundation.org',
  'resolutionfoundation.org', 'wellcome.org', 'crick.ac.uk', 'sanger.ac.uk',
  'lshtm.ac.uk', 'ceh.ac.uk', 'bas.ac.uk', 'npl.co.uk', 'stfc.ac.uk',
  'nihr.ac.uk', 'hesa.ac.uk', 'jstor.org',
  // Open repositories and proceedings — not UK, but primary research rather
  // than reporting. Several of these were added after a live probe returned
  // `pmc.ncbi.nlm.nih.gov` and `papers.neurips.cc` unflagged: a list that
  // misses the repositories a search actually returns cannot express a
  // preference for academic sources, however carefully the arithmetic is tuned.
  'arxiv.org', 'semanticscholar.org', 'doaj.org', 'zenodo.org', 'osf.io',
  'pubmed.ncbi.nlm.nih.gov', 'pmc.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov',
  'europepmc.org', 'biorxiv.org', 'medrxiv.org', 'ssrn.com',
  'papers.neurips.cc', 'proceedings.mlr.press', 'aclanthology.org',
  'openreview.net', 'dl.acm.org', 'ieeexplore.ieee.org', 'plos.org',
]);

const ACADEMIC_SUFFIXES = ['.ac.uk', '.edu', '.ac.at', '.ac.nz', '.edu.au', '.ac.jp'];

/** True for a university, research institute or open repository. */
export function isAcademic(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  if (ACADEMIC_HOSTS.has(host)) return true;
  return ACADEMIC_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Sources with an interest in the claim being true.
 *
 * WHY A PENALTY AND NOT A FILTER. A company's own page is often the only place
 * a detail exists, and for "what does this product do" it is the right source.
 * What it must not do is outrank an independent one by default, which is what
 * happens when a search engine ranks on relevance alone — the subject's own
 * site is always the most relevant page about the subject.
 *
 * Two deterministic signals, both cheap:
 *
 *  - The host's brand label appears in the claim. A claim about Acme cited to
 *    acme.com is Acme talking about Acme. This is why `subject` is the CLAIM
 *    text rather than the whole post: matching against the post would flag
 *    every source for a post that happens to mention the BBC once.
 *  - Press-release wires, which exist to publish text an interested party
 *    wrote. A wire is not a second source for the thing it announces.
 *
 * `strangeramblings.com` is in the wire list for the same reason: citing your
 * own blog as evidence for your own blog post is circular.
 */
const PR_WIRES = new Set([
  'prnewswire.com', 'businesswire.com', 'globenewswire.com', 'prweb.com',
  'newswire.com', 'einpresswire.com', 'accesswire.com', 'prlog.org',
  'openpr.com', 'pressat.co.uk', 'responsesource.com',
  'strangeramblings.com',
]);

/**
 * Host labels too common to be evidence of affiliation.
 *
 * `time.com`, `nature.com` and `independent.co.uk` reduce to labels that appear
 * in ordinary English, so matching them against claim text flags a source as
 * self-interested on the strength of the word "time". A four-character floor
 * alone was not enough — this list is the rest of the guard, and every entry is
 * here because it is a real publication whose name is also a common word.
 */
const COMMON_LABELS = new Set([
  'time', 'news', 'post', 'mail', 'sun', 'star', 'independent', 'observer',
  'economist', 'nature', 'science', 'cell', 'conversation', 'week', 'today',
  'about', 'data', 'world', 'global', 'first', 'open', 'live', 'next', 'week',
]);

/** The registrable label of a host: `acme` from `www.acme.co.uk`. */
export function brandLabel(url: string): string {
  const host = hostnameOf(url);
  if (!host) return '';
  const parts = host.split('.');
  // Strip the public suffix, which may be one label (.com) or two (.co.uk).
  const twoPart = new Set(['co', 'ac', 'gov', 'org', 'net', 'sch', 'nhs', 'police', 'mod']);
  let idx = parts.length - 2;
  if (parts.length >= 3 && twoPart.has(parts[parts.length - 2])) idx = parts.length - 3;
  return (parts[idx] ?? '').toLowerCase();
}

export function isAffiliated(url: string, subject?: string): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  if (PR_WIRES.has(host)) return true;
  if (!subject) return false;

  const label = brandLabel(url);
  if (label.length < 4 || COMMON_LABELS.has(label)) return false;
  // Whole-word match only: `bbc` inside `bbcworld` is not the same claim.
  return new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(subject);
}

export function reputationScore(url: string): number {
  return isReputable(url) ? 1 : 0;
}

/**
 * The bonus added to a search engine's own relevance score before ranking.
 *
 * The order these produce, for an equally relevant result, is the order John
 * asked for: UK academics, then other academics, then UK institutions and
 * press, then everyone else — with anything self-interested pushed below its
 * own tier rather than removed.
 *
 *   UK university      0.5 + 0.25 + 0.3  = 1.05
 *   US university      0.5 + 0.3         = 0.8
 *   ONS / BBC          0.5 + 0.25        = 0.75
 *   Reuters / NYT      0.5               = 0.5
 *   UK personal blog         0.25        = 0.25
 *   the subject's own UK university page: 1.05 − 0.5 = 0.55
 *
 * THE WHOLE STACK IS DELIBERATELY WORTH ABOUT ONE POINT, because Tavily's
 * relevance is 0..1 and these must not swamp it. An earlier cut used 1/0.4/0.5
 * with a −0.8 penalty, and a test caught what that does: a barely-relevant
 * university page (0.20) outranked a near-perfect Reuters match (0.99), because
 * the gap between their tiers was 0.9 and the gap in relevance was only 0.79.
 * Ranking a page that is not about the claim above one that is, on the strength
 * of its domain, is worse than any ordering it was meant to fix.
 *
 * With these numbers the property holds: a MUCH better match wins across tiers
 * (Reuters 0.99 + 0.5 = 1.49 beats Oxford 0.20 + 1.05 = 1.25), and an equally
 * good one loses to the preferred tier (both at 0.70: Oxford 1.75, Reuters
 * 1.20). These are tie-breaks between sources that could all be cited, not a
 * ranking of truth — which is also why nothing here filters. A filter starves
 * the search whenever the only page carrying a fact is one this arithmetic
 * dislikes.
 *
 * ONE function, used by every caller — `$lib/blog/desk/ground.server`,
 * `/api/admin/blog/review-claims` and `/api/admin/blog/search-sources` all rank
 * the same Tavily results for the same post, and copies of this arithmetic
 * would give the writing desk and the sources panel a different top source off
 * one claim, which reads as a bug in whichever one you opened second.
 */
export const REPUTABLE_BONUS = 0.5;
export const UK_BONUS = 0.25;
export const ACADEMIC_BONUS = 0.3;
/** Negative. Large enough to drop a source a full tier, small enough that a
 *  clearly-best match survives it. */
export const AFFILIATION_PENALTY = -0.5;

export type SourceRating = {
  reputable: boolean;
  uk: boolean;
  academic: boolean;
  /** Has an interest in the claim: the subject's own site, or a press wire. */
  affiliated: boolean;
  /** Added to the search engine's relevance score. May be negative. */
  bonus: number;
};

/** `subject` is the CLAIM text, not the post — see `isAffiliated`. */
export function rateSource(url: string, subject?: string): SourceRating {
  const reputable = isReputable(url);
  const uk = isUkSource(url);
  const academic = isAcademic(url);
  const affiliated = isAffiliated(url, subject);
  return {
    reputable,
    uk,
    academic,
    affiliated,
    bonus:
      (reputable ? REPUTABLE_BONUS : 0) +
      (uk ? UK_BONUS : 0) +
      (academic ? ACADEMIC_BONUS : 0) +
      (affiliated ? AFFILIATION_PENALTY : 0),
  };
}

/** One search result, as every caller here receives it from Tavily. */
export type SearchResult = { url: string; title: string; content: string; score: number };

export type RankedSource = {
  url: string;
  title: string;
  domain: string;
  rating: SourceRating;
  /** Verbatim page extract. Callers trim it to whatever their UI shows. */
  snippet: string;
  score: number;
};

/**
 * Rank search results for one claim.
 *
 * `exclude` is what makes "search again" useful: re-running a query returns
 * substantially the same page one for the same words, so a second look that
 * did not drop what the author has already rejected would show them the same
 * four sources and read as a broken button.
 */
export function rankSources(
  results: SearchResult[],
  opts: {
    subject?: string;
    exclude?: Iterable<string>;
    limit?: number;
    /**
     * How many results one domain may contribute.
     *
     * Measured against live Tavily data for "UK inflation rate 2026 official
     * statistics": the top six were four `ons.gov.uk` pages and two `gov.uk`
     * ones — six rows offering two actual choices. That is a poor list on its
     * own, and it is a worse one given the author reaches for "search again"
     * precisely when they want a different source rather than another page of
     * the same site.
     */
    maxPerDomain?: number;
  } = {},
): RankedSource[] {
  const seen = new Set<string>();
  for (const u of opts.exclude ?? []) {
    const h = hostnameOf(u);
    // Exclude by exact URL and by host: a second page from the same domain is
    // rarely the independent second look the author was asking for.
    seen.add(u);
    if (h) seen.add(h);
  }

  const ranked = (results ?? [])
    .filter((r) => r && typeof r.url === 'string' && r.url)
    .filter((r) => !seen.has(r.url) && !seen.has(hostnameOf(r.url)))
    .map((r) => {
      const rating = rateSource(r.url, opts.subject);
      return {
        url: r.url,
        title: r.title || hostnameOf(r.url),
        domain: hostnameOf(r.url),
        rating,
        snippet: r.content ?? '',
        score: (r.score ?? 0) + rating.bonus,
      };
    })
    .sort((a, b) => b.score - a.score);

  // Diversity pass, AFTER the sort so each domain keeps its best pages.
  const perDomain = new Map<string, number>();
  const cap = opts.maxPerDomain ?? 2;
  const out: RankedSource[] = [];
  const overflow: RankedSource[] = [];
  for (const r of ranked) {
    const n = perDomain.get(r.domain) ?? 0;
    if (n < cap) {
      perDomain.set(r.domain, n + 1);
      out.push(r);
    } else {
      overflow.push(r);
    }
  }
  // A thin result set must not be made thinner by the cap: if one domain is
  // genuinely all there is, showing four of its pages beats showing two and a
  // gap. Overflow is appended only once every domain has had its share.
  return [...out, ...overflow].slice(0, opts.limit ?? 4);
}
