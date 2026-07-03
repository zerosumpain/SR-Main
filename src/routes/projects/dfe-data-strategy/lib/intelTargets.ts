// intelTargets.ts — client-safe routing for the intelligence sweep. There is no radar
// page any more: each classified item surfaces INSIDE the section it bears on (an Act
// on the legislation page, a spine announcement on the commitments ledger). This module
// decides which section(s) an item belongs to, and what counts as "newly arrived".

export type IntelSection = 'legislation' | 'commitments' | 'landscape' | 'strategies' | 'frameworks';

/** The slim intel item shipped to the client via the project layout load. */
export interface IntelSlim {
  id: string;
  title: string;
  url: string;
  publisher: string | null;
  docType: string | null;
  summary: string | null;
  relevance: number;
  influences: { kind: string; id: string; label: string; how: string; direction: string }[];
  misalignments: { point: string; severity: string }[];
  publishedAt: string | null;
  firstSeenAt: string | null;
  watch: string | null;
  watchLabel: string | null;
}

export interface IntelLayoutData {
  items: IntelSlim[];
  lastRun: { runAt: string; ok: boolean; itemsFound: number; itemsNew: number; classified: number; error: string | null } | null;
}

/** Where each named watch's finds belong. */
const WATCH_SECTIONS: Record<string, IntelSection[]> = {
  cwsa: ['legislation', 'commitments'],
  'data-law': ['legislation'],
  ndl: ['commitments', 'frameworks'],
  'data-spine': ['commitments'],
  registers: ['commitments', 'legislation'],
  'school-profiles': ['commitments'],
};

const LEGAL_RE = /\b(act|bill|regulations?|statutory|commencement|legislation|gateway|lawful basis)\b/i;
const FRAMEWORK_RE = /\b(framework|data standards?|maturity assessment|code of practice)\b/i;

/** The section pages a classified item should surface on (always at least one). */
export function intelTargets(i: IntelSlim): IntelSection[] {
  const out = new Set<IntelSection>();
  if (i.watch) for (const s of WATCH_SECTIONS[i.watch] ?? []) out.add(s);
  const hay = `${i.title} ${i.summary ?? ''} ${i.docType ?? ''}`;
  if (LEGAL_RE.test(hay)) out.add('legislation');
  if (FRAMEWORK_RE.test(hay)) out.add('frameworks');
  for (const inf of i.influences) {
    if (inf.kind === 'pressure') out.add('landscape');
    if (inf.kind === 'strategy') out.add('strategies');
  }
  if (!out.size) out.add('landscape');
  return [...out];
}

/** "Newly arrived" = first seen (or published) within the last fortnight. */
export function isFreshIntel(i: IntelSlim, days = 14): boolean {
  const t = i.firstSeenAt ?? i.publishedAt;
  if (!t) return false;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) && Date.now() - ms < days * 86_400_000;
}

const timeOf = (i: IntelSlim) => {
  const t = i.publishedAt ?? i.firstSeenAt;
  const ms = t ? new Date(t).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
};

/** Items for one section — fresh first, then newest, then most relevant. */
export function intelForSection(items: IntelSlim[], section: IntelSection): IntelSlim[] {
  return items
    .filter((i) => intelTargets(i).includes(section))
    .sort((a, b) => (Number(isFreshIntel(b)) - Number(isFreshIntel(a))) || timeOf(b) - timeOf(a) || b.relevance - a.relevance);
}
