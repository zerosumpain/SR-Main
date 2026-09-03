// The briefing's fact sheet, as the hub's primitives want it.
//
// Two surfaces read the same record — the briefing room's panel (the latest
// day) and `/jkai/daydreams/briefing/[day]` (any day) — and the spec asks both
// to open on the SAME rollup. So the grouping, the slugs, the tones and the
// cells live here once rather than being written twice and drifting into two
// different section orders, which is how the old panel ended up hiding
// "New memories" from its own fact ledger while the drawer still counted it.
//
// This is a `.ts` beside the components rather than in `$lib/briefing` because
// `RollupCell`/`FactRow` are UI shapes: `$lib/briefing` is a `domain` module
// and the boundary gate does not let a domain module import `$lib/components`.
import type { BriefingData, BriefingDetail, BriefingFactRow } from '$lib/briefing/types';
import type { Tone } from '$lib/daydream/priority';
import type { FactRow, RollupCell } from './hub/types';

/** The one section the daydream engine writes for itself. It leads. */
export const DAYDREAMS_SECTION = 'Daydreams';

/** `Weather · where you are` → `weather-where-you-are`. */
export function sectionSlug(section: string): string {
  return (
    section
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

export interface BriefingFactSection {
  section: string;
  slug: string;
  facts: BriefingFactRow[];
}

/**
 * The record's fact sections in the record's own order — except Daydreams,
 * which is hoisted to the front. It is the section this hub exists for, and it
 * is the one the composer appends last.
 */
export function briefingFactSections(detail: BriefingDetail | null | undefined): BriefingFactSection[] {
  const out: BriefingFactSection[] = [];
  for (const fact of detail?.facts ?? []) {
    let group = out.find((g) => g.section === fact.section);
    if (!group) {
      group = { section: fact.section, slug: sectionSlug(fact.section), facts: [] };
      out.push(group);
    }
    group.facts.push(fact);
  }
  const lead = out.findIndex((g) => g.section === DAYDREAMS_SECTION);
  if (lead > 0) out.unshift(out.splice(lead, 1)[0]);
  return out;
}

/** A value carrying a clock time is an id, not prose — it gets the mono face. */
function isTimeish(value: string): boolean {
  return /\d{1,2}:\d{2}/.test(value);
}

export function briefingFactRows(facts: BriefingFactRow[]): FactRow[] {
  return facts.map((fact) => ({
    label: fact.label,
    value: fact.value,
    href: fact.href ?? null,
    mono: isTimeish(fact.value),
  }));
}

/** ok/total across the run's sources. */
export function sourceTally(detail: BriefingDetail | null | undefined): { ok: number; total: number } {
  const sources = detail?.sources ?? [];
  return { ok: sources.filter((s) => s.status === 'ok').length, total: sources.length };
}

/** ok/total as a tone: all clear is good, half a ledger down is urgent. */
export function briefingSourceTone(ok: number, total: number): Tone {
  if (!total) return 'quiet';
  const ratio = ok / total;
  if (ratio === 1) return 'good';
  if (ratio >= 0.75) return 'steady';
  if (ratio >= 0.5) return 'watch';
  return 'urgent';
}

/** The first line of the block the WhatsApp message carried, for a cell's sub. */
function daydreamsLead(detail: BriefingDetail | null | undefined): string | null {
  const first = (detail?.daydreamsText ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return first || null;
}

/**
 * The rollup every briefing surface opens on: one even cell per fact section,
 * then the two run-health cells.
 *
 * `hrefBase` is '' on the day page (the anchors are on that page) and the day
 * page's URL on the panel, so a cell there navigates to the section it counts.
 */
export function briefingRollupCells(briefing: BriefingData, hrefBase = ''): RollupCell[] {
  const detail = briefing.detail ?? null;
  const sections = briefingFactSections(detail);
  const lead = daydreamsLead(detail);

  const cells: RollupCell[] = sections.map((group) => {
    const isDaydreams = group.section === DAYDREAMS_SECTION;
    return {
      key: group.slug,
      label: group.section,
      value: String(group.facts.length),
      sub: (isDaydreams ? lead : null) ?? group.facts[0]?.label ?? null,
      tone: isDaydreams ? 'action' : 'steady',
      href: `${hrefBase}#sec-${group.slug}`,
    } satisfies RollupCell;
  });

  const gaps = detail?.gaps ?? [];
  cells.push({
    key: 'gaps',
    label: 'Gaps',
    value: String(gaps.length),
    sub: gaps.length ? gaps.map((gap) => gap.section).join(', ') : 'nothing was left out',
    tone: gaps.length ? 'watch' : 'good',
    href: `${hrefBase}#sec-run-health`,
  });

  const { ok, total } = sourceTally(detail);
  cells.push({
    key: 'sources',
    label: 'Sources',
    value: String(ok),
    suffix: `/${total}`,
    sub: total ? `${total - ok} did not report` : 'no source ledger on this record',
    tone: briefingSourceTone(ok, total),
    href: `${hrefBase}#sec-run-health`,
  });

  return cells;
}
