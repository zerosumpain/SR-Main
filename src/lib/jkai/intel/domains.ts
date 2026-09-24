// Where intel came from, at the grain a person asks about.
//
// `intel_notes.source` is a pipeline detail — 'web' is both a kept news story
// (until 2026-09-24) and a "remember that" from chat, 'daydream' and 'notebook'
// are both research. A DOMAIN is the question "show me what email told me".
// Pure: the entity view judges each source with `domainOf`, the evidence view
// expands `domains=` through `sourcesForDomains` into SQL, and the picker labels
// and counts come from here, so the grouping lives in exactly one place.

export type DomainId =
  | 'email' | 'news' | 'documents' | 'chat' | 'research' | 'automations' | 'home' | 'other';

export interface IntelDomain {
  id: DomainId;
  label: string;
  hint: string;
  sources: readonly string[];
}

export const INTEL_DOMAINS: readonly IntelDomain[] = [
  { id: 'email', label: 'Email', hint: 'Gmail, rolling 12 weeks', sources: ['email'] },
  { id: 'news', label: 'News', hint: 'Stories kept from /news', sources: ['news'] },
  { id: 'documents', label: 'Documents', hint: 'Drive files', sources: ['file'] },
  { id: 'chat', label: 'Chat & capture', hint: 'jkai threads, captures, phone, WhatsApp', sources: ['chat', 'web', 'pwa', 'whatsapp'] },
  { id: 'research', label: 'Research', hint: 'Deep dives, daydream, notebook', sources: ['research', 'daydream', 'notebook'] },
  { id: 'automations', label: 'Automations', hint: 'Workflow output', sources: ['workflow'] },
  { id: 'home', label: 'Home', hint: 'Home Assistant — coming', sources: ['home'] },
  { id: 'other', label: 'Other', hint: 'Sources with no domain yet', sources: [] },
];

const BY_SOURCE = new Map<string, DomainId>(
  INTEL_DOMAINS.flatMap((d) => d.sources.map((s) => [s, d.id] as const)),
);

/** Base source of a facet value: 'email:bulk' and 'email@x.com' are 'email'. */
function baseSource(source: string): string {
  const cut = source.search(/[:@]/);
  return cut > 0 ? source.slice(0, cut) : source;
}

export function domainOf(source: string): DomainId {
  return BY_SOURCE.get(baseSource(source)) ?? 'other';
}

export function sourcesForDomains(domains: readonly string[]): string[] {
  return INTEL_DOMAINS.filter((d) => domains.includes(d.id)).flatMap((d) => [...d.sources]);
}

/**
 * How many items fall in each domain, each item counted ONCE per domain.
 *
 * Takes the items rather than per-source totals because totals cannot be
 * de-duplicated: an entity asserted by research AND daydream is one Research
 * entity, and summing the two source counts made it two. Every domain comes
 * back, in table order, so the picker can show an empty one as empty.
 *
 * Facets ('email:bulk', 'email@x.com') are ignored — they refine a base source
 * the item also carries, not a second origin. An unknown source is 'other'.
 *
 * `count` lets a caller pass a pre-aggregated group of identical items (the
 * evidence view's per-source note counts) instead of one object per row; it is
 * only honest when the items in a group are distinct from every other group's.
 */
export function domainCountsFromNodes(
  nodes: Iterable<{ sources: readonly string[]; count?: number }>,
): Array<{ id: DomainId; count: number }> {
  const totals = new Map<DomainId, number>();
  for (const node of nodes) {
    const hit = new Set<DomainId>();
    for (const source of node.sources) {
      if (/[:@]/.test(source)) continue;
      hit.add(domainOf(source));
    }
    for (const d of hit) totals.set(d, (totals.get(d) ?? 0) + (node.count ?? 1));
  }
  return INTEL_DOMAINS.map((d) => ({ id: d.id, count: totals.get(d.id) ?? 0 }));
}
