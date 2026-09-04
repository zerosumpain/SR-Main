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

export function reputationScore(url: string): number {
  return isReputable(url) ? 1 : 0;
}

/**
 * The bonus added to a search engine's own relevance score before ranking.
 *
 * Deliberately SMALLER than the reputable bonus. Reputation is about whether a
 * source can be cited at all; nationality is only a tie-break between sources
 * that could both be cited, and a UK bonus large enough to outrank reputation
 * would promote a parish newsletter over the ONS. +1 reputable, +0.4 UK: a
 * reputable UK source leads, a reputable non-UK source still beats an
 * unvetted UK one, and Tavily's relevance (0..1) can still overturn either.
 *
 * ONE function, used by both callers — `$lib/blog/desk/ground.server` and
 * `/api/admin/blog/review-claims` both rank the same Tavily results for the
 * same post, and two copies of this arithmetic would give the writing desk and
 * the sources panel a different top source off one claim, which reads as a bug
 * in whichever one you opened second.
 */
export const REPUTABLE_BONUS = 1;
export const UK_BONUS = 0.4;

export type SourceRating = {
  reputable: boolean;
  uk: boolean;
  /** Added to the search engine's relevance score. */
  bonus: number;
};

export function rateSource(url: string): SourceRating {
  const reputable = isReputable(url);
  const uk = isUkSource(url);
  return {
    reputable,
    uk,
    bonus: (reputable ? REPUTABLE_BONUS : 0) + (uk ? UK_BONUS : 0),
  };
}
