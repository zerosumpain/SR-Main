import { REPORT_SECTIONS, type Artefact, type Kind } from './contracts';
import { BANDS, byExposure, type Band } from './exposure';
export type { Band };

// Everything the dashboard shows, derived once from the artefact list.
//
// The page is read by policy professionals, not by the people who built the
// pipeline, so the shaping happens here rather than in the markup: which play
// ranks where, which actor a play belongs to, which of the twelve checks came
// back thin. Keeping it in a plain module means it can be tested without
// mounting anything, and the components stay presentational.

export type Play = {
  artefact: Artefact;
  actor: Artefact | null;
  band: Band;
  exposure: number;
  factors: { key: string; value: number }[];
};

export type ActorView = {
  actor: Artefact;
  profile: Artefact | null;
  plays: Play[];
  /** Highest exposure among this actor's plays, for ordering the board. */
  worst: number;
};

export const FACTOR_KEYS = ['incentive', 'ease', 'impact', 'concealment'] as const;

export const EVIDENCE_RESULTS = [
  { key: 'supports', label: 'Supports', hue: 'var(--fs-cat-operational)' },
  { key: 'contradicts', label: 'Contradicts', hue: 'var(--fs-cat-trust)' },
  { key: 'mixed', label: 'Mixed', hue: 'var(--fs-cat-standards)' },
  { key: 'insufficient', label: 'Insufficient', hue: 'var(--fs-cat-identifier)' },
] as const;

export const TEST_RESULTS = [
  { key: 'high_risk', label: 'High risk', hue: 'var(--error)' },
  { key: 'moderate_risk', label: 'Moderate risk', hue: 'var(--warn)' },
  { key: 'low_risk', label: 'Covered', hue: 'var(--good)' },
  { key: 'indeterminate', label: 'No evidence either way', hue: 'var(--text-muted)' },
] as const;

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function of(artefacts: Artefact[], kind: Kind): Artefact[] {
  return artefacts.filter((a) => a.kind === kind);
}

/** Exploitation plays, worst first, joined to the actor that would run them. */
export function plays(artefacts: Artefact[]): Play[] {
  const actors = new Map(of(artefacts, 'actor').map((a) => [a.id, a]));
  return [...of(artefacts, 'exploit')].sort(byExposure).map((artefact) => ({
    artefact,
    actor: actors.get(String(artefact.data.actorId)) ?? null,
    band: (String(artefact.data.band) as Band) || 'limited',
    exposure: num(artefact.data.exposure),
    factors: FACTOR_KEYS.map((key) => ({ key, value: num(artefact.data[key]) })),
  }));
}

export function bandCounts(list: Play[]): { band: Band; note: string; count: number }[] {
  return BANDS.map(({ band, note }) => ({ band, note, count: list.filter((p) => p.band === band).length }));
}

/** One card per profiled actor, ordered by the worst play they could run. */
export function actorBoard(artefacts: Artefact[], list: Play[]): ActorView[] {
  const profiles = of(artefacts, 'profile');
  return of(artefacts, 'actor')
    .filter((a) => a.id.startsWith('s2_'))
    .map((actor) => {
      const own = list.filter((p) => p.actor?.id === actor.id);
      return { actor, profile: profiles.find((p) => p.data.actorId === actor.id) ?? null, plays: own, worst: own[0]?.exposure ?? 0 };
    })
    .sort((a, b) => b.worst - a.worst || (b.plays.length - a.plays.length) || a.actor.label.localeCompare(b.actor.label));
}

/** The twelve deterministic checks, worst first — a shortfall is the headline. */
export function checks(artefacts: Artefact[]): Artefact[] {
  const rank = TEST_RESULTS.map((r) => r.key);
  return [...of(artefacts, 'test')].sort((a, b) => rank.indexOf(String(a.data.result) as never) - rank.indexOf(String(b.data.result) as never));
}

export function evidenceMix(artefacts: Artefact[]): { key: string; label: string; hue: string; count: number }[] {
  const rows = of(artefacts, 'evidence');
  return EVIDENCE_RESULTS.map((r) => ({ ...r, count: rows.filter((e) => e.data.result === r.key).length }));
}

/** Assumptions the analysis itself ranked highest on importance × uncertainty × consequence. */
export function fragileAssumptions(artefacts: Artefact[]): Artefact[] {
  return [...of(artefacts, 'assumption')]
    .map((a) => ({ a, p: num(a.data.priority) || num(a.data.importance) * num(a.data.uncertainty) * num(a.data.consequence) }))
    .sort((x, y) => y.p - x.p)
    .map((x) => x.a);
}

export function findingsBySection(artefacts: Artefact[]): { section: string; label: string; items: Artefact[] }[] {
  const items = of(artefacts, 'finding');
  return REPORT_SECTIONS.map((section) => ({
    section,
    label: section.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase()),
    items: items.filter((f) => f.data.section === section),
  })).filter((s) => s.items.length);
}

export function headline(artefacts: Artefact[]): Artefact | null {
  return of(artefacts, 'finding').find((f) => f.data.section === 'executive_assessment') ?? null;
}

/**
 * The four figures across the top. Each is a count the reader can act on, not a
 * measure of how much machinery ran.
 */
export function tiles(artefacts: Artefact[], list: Play[]) {
  const severe = list.filter((p) => p.band === 'severe' || p.band === 'significant').length;
  const failing = of(artefacts, 'test').filter((t) => ['high_risk', 'moderate_risk'].includes(String(t.data.result)));
  const unresolved = of(artefacts, 'evidence').filter((e) => ['insufficient', 'contradicts'].includes(String(e.data.result)));
  return [
    { key: 'plays', figure: list.length, sub: severe ? `${severe} worth acting on` : 'none ranked above moderate', label: 'Ways to beat it' },
    { key: 'actors', figure: of(artefacts, 'profile').length, sub: `${of(artefacts, 'actor').filter((a) => a.id.startsWith('s2_')).length} named in the policy`, label: 'Actors profiled' },
    { key: 'checks', figure: failing.length, sub: `of ${of(artefacts, 'test').length} structural checks`, label: 'Checks that fell short' },
    { key: 'evidence', figure: unresolved.length, sub: `of ${of(artefacts, 'evidence').length} evidence links`, label: 'Unsupported or disputed' },
  ];
}

/**
 * Point geometry for the ease × impact plot.
 *
 * The box is 360 user units rather than 100 so that the axis labels can carry a
 * real type token: SVG text scales with the viewBox, and 12px inside a 100-unit
 * box would be a twelfth of the chart. At 360 it is the size it looks.
 */
export const PLOT_SIZE = 360;
export function plotPoints(list: Play[], size = PLOT_SIZE, pad = 44) {
  const span = size - pad * 2;
  return list.map((play, index) => ({
    play,
    index,
    x: pad + num(play.artefact.data.ease) * span,
    y: pad + (1 - num(play.artefact.data.impact)) * span,
    r: 8 + play.exposure * 16,
  }));
}

/**
 * Exposure is a MAGNITUDE, so its four bands are one hue stepped light to dark
 * rather than four colours. That is also why the ramp is CVD-safe by
 * construction — and every band is printed in words beside its mark anyway.
 * `--error` was the obvious pick for `severe` and is ruled out: against
 * `--accent` it scores ΔE 6.8 to a normal-vision reader, below the floor of 15.
 */
export const BAND_FILL: Record<Band, string> = {
  severe: 'var(--accent)',
  significant: 'color-mix(in oklab, var(--accent) 60%, var(--bg))',
  moderate: 'color-mix(in oklab, var(--accent) 32%, var(--bg))',
  limited: 'color-mix(in oklab, var(--accent) 15%, var(--bg))',
};

export const BAND_LABEL: Record<Band, string> = {
  severe: 'Severe', significant: 'Significant', moderate: 'Moderate', limited: 'Limited',
};
