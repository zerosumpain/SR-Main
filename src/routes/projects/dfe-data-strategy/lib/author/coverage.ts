// coverage.ts — the deterministic coverage sweep behind the Author's Verify tab.
// Matches the draft's text against the commitments ledger (via each commitment's
// curated aliases) and the eight capability areas, at word boundaries, case-
// insensitively. Two distinct alias hits = addressed; one = touched; none = missing.
// Pure and instant — the judgement-call review lives in the /review endpoint.

import { COMMITMENTS, STATUS_META } from '../commitments';
import { CAPABILITY_AREAS } from '../capabilities';
import { htmlToText } from './serialize';
import type { StrategyDoc } from './templates';

export type CoverageLevel = 'addressed' | 'touched' | 'missing';

export interface CoverageHit {
  id: string;
  kind: 'commitment' | 'pressure' | 'capability';
  level: CoverageLevel;
  /** The aliases that matched. */
  hits: string[];
  /** The sections where at least one alias matched. */
  sectionIds: string[];
}

export interface CoverageResult {
  items: CoverageHit[];
  gaps: CoverageHit[];
  statutoryGaps: CoverageHit[];
  /** 0–1: weighted share of commitments+capabilities the draft speaks to. */
  score: number;
}

/** Hand-curated match terms for the capability areas (ids from capabilities.ts). */
export const CAPABILITY_ALIASES: Record<string, string[]> = {
  governance: ['data governance', 'data ownership', 'stewardship', 'information asset', 'SIRO', 'data owners', 'operating model', 'decision rights'],
  platform: ['platform', 'data infrastructure', 'cloud', 'data spine', 'warehouse', 'data engineering', 'pipelines', 'catalogue'],
  skills: ['data skills', 'data literacy', 'data profession', 'analysts', 'capability building', 'training', 'data culture'],
  interoperability: ['interoperability', 'data standards', 'API', 'APIs', 'common data model', 'schema', 'metadata', 'reference data'],
  quality: ['data quality', 'accuracy', 'completeness', 'timeliness', 'validation', 'single source of truth'],
  ethics: ['ethics', 'public trust', 'transparency', 'algorithmic', 'fairness', 'privacy', 'DPIA'],
  sharing: ['data sharing', 'information sharing', 'data-sharing', 'gateway', 'sharing agreement', 'linkage', 'joined up', 'multi-agency'],
  value: ['analytics', 'insight', 'evaluation', 'evidence-based', 'dashboards', 'decision support', 'data products'],
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function aliasRegex(alias: string): RegExp {
  // word-boundary, case-insensitive; allow flexible whitespace/hyphens inside multi-word aliases
  const inner = escapeRe(alias.trim()).replace(/\\?[\s-]+/g, '[\\s-]+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${inner}(?=$|[^\\p{L}\\p{N}])`, 'iu');
}

interface Target {
  id: string;
  kind: CoverageHit['kind'];
  aliases: string[];
  statutory: boolean;
  rank: number;
}

function targets(): Target[] {
  const t: Target[] = COMMITMENTS.map((c) => ({
    id: c.id,
    kind: 'commitment' as const,
    aliases: c.aliases,
    statutory: c.status === 'statutory-duty' || c.status === 'legislated-not-commenced',
    rank: STATUS_META[c.status].rank,
  }));
  for (const cap of CAPABILITY_AREAS)
    t.push({ id: cap.id, kind: 'capability', aliases: CAPABILITY_ALIASES[cap.id] ?? [cap.name], statutory: false, rank: 99 });
  return t;
}

export function runCoverage(doc: StrategyDoc): CoverageResult {
  const sections = doc.sections.map((s) => ({ id: s.id, text: htmlToText(s.html) }));
  const items: CoverageHit[] = [];

  for (const target of targets()) {
    const hits = new Set<string>();
    const sectionIds = new Set<string>();
    for (const alias of target.aliases) {
      const re = aliasRegex(alias);
      for (const s of sections) {
        if (s.text && re.test(s.text)) {
          hits.add(alias);
          sectionIds.add(s.id);
        }
      }
    }
    const level: CoverageLevel = hits.size >= 2 ? 'addressed' : hits.size === 1 ? 'touched' : 'missing';
    items.push({ id: target.id, kind: target.kind, level, hits: [...hits], sectionIds: [...sectionIds] });
  }

  const byId = new Map(targets().map((t) => [t.id, t]));
  const gaps = items
    .filter((i) => i.level === 'missing')
    .sort((a, b) => (byId.get(a.id)?.rank ?? 99) - (byId.get(b.id)?.rank ?? 99));
  const statutoryGaps = gaps.filter((g) => byId.get(g.id)?.statutory);

  const weight = (l: CoverageLevel) => (l === 'addressed' ? 1 : l === 'touched' ? 0.5 : 0);
  const score = items.length ? items.reduce((s, i) => s + weight(i.level), 0) / items.length : 0;

  return { items, gaps, statutoryGaps, score };
}
