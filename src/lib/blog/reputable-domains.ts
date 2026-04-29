// Domains we treat as reputable for blog citation purposes.
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

export function reputationScore(url: string): number {
  return isReputable(url) ? 1 : 0;
}
