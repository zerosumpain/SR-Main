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

/**
 * The written assessment, told as five acts rather than fifteen chapters.
 *
 * The report contract has fifteen sections and the page listed all of them, in
 * contract order, one after another. That is an index, not a narrative: a reader
 * who is not the person who built the pipeline has no way to tell that
 * `scope_methodology` qualifies the verdict above it while `distribution` is
 * about who pays. The acts group them the way the argument actually runs —
 * what the assessment concludes, what the policy is trying to do, what that
 * rests on, where it breaks, and what to do about it — so a reader can take one
 * at a time and know where they are.
 *
 * Every section keeps its own heading inside its act, so nothing is hidden or
 * renamed; the grouping is navigation, not editing.
 */
export const REPORT_ACTS = [
  {
    key: 'verdict',
    title: 'The verdict',
    strap: 'What this assessment concludes, and the ground it was drawn from.',
    sections: ['executive_assessment', 'scope_methodology'],
  },
  {
    key: 'intent',
    title: 'What the policy is trying to do',
    strap: 'Its objectives, the machinery meant to deliver them, and the actors it names.',
    sections: ['objectives', 'mechanisms', 'actors'],
  },
  {
    key: 'foundations',
    title: 'What it rests on',
    strap: 'The assumptions holding it up, and how much is actually established.',
    sections: ['high_risk_assumptions', 'evidence_gaps', 'confidence_uncertainty'],
  },
  {
    key: 'failure',
    title: 'Where it breaks',
    strap: 'The plays an actor can run, the conditions that change the answer, and the checks that fell short.',
    sections: ['exploitation', 'scenarios', 'test_results'],
  },
  {
    key: 'response',
    title: 'What to do about it',
    strap: 'Redesign options, who carries the burden, what spans other policies, and what is still open.',
    sections: ['strategic_responses', 'distribution', 'cross_policy', 'unresolved_questions'],
  },
] as const;

export type ActKey = (typeof REPORT_ACTS)[number]['key'];
export type ReportAct = {
  key: ActKey;
  title: string;
  strap: string;
  chapters: { section: string; label: string; items: Artefact[] }[];
  count: number;
};

/**
 * Group the findings into acts, dropping any act the assessment did not reach.
 *
 * A section with no finding is not rendered, and an act with no section at all
 * is not offered as a tab — an empty tab is a dead end the reader has to click
 * to discover.
 */
export function reportActs(artefacts: Artefact[]): ReportAct[] {
  const bySection = new Map(findingsBySection(artefacts).map((s) => [s.section, s]));
  return REPORT_ACTS.map((act) => {
    const chapters = act.sections.map((s) => bySection.get(s)).filter((c): c is NonNullable<typeof c> => Boolean(c));
    return { key: act.key, title: act.title, strap: act.strap, chapters, count: chapters.reduce((n, c) => n + c.items.length, 0) };
  }).filter((act) => act.chapters.length);
}

/** Report sections carrying a finding that no act claims — a contract change would show up here. */
export function unplacedSections(artefacts: Artefact[]): string[] {
  const claimed = new Set<string>(REPORT_ACTS.flatMap((a) => a.sections as readonly string[]));
  return findingsBySection(artefacts).map((s) => s.section).filter((s) => !claimed.has(s));
}

/**
 * What the assessment cost, in tokens and — only where there is one — in cash.
 *
 * `policy_model_calls.usage` is an ARRAY, not a record: a call that needed a
 * corrective round-trip appends the second attempt rather than replacing the
 * first, so summing the array is the only way to count what was actually spent.
 *
 * Codex prices as `null`, never `0` — it is subscription quota, not cash — so a
 * run served entirely by the bridge must not report "$0.00" as though it were
 * free money. `cash` is null when nothing reported a price, and the page says
 * which of the two it is in words.
 *
 * This is not `rollupUsage` from `$lib/context/execution`, which sums the same
 * `LLMCallRecord[]` with the same null-preserving arithmetic: that module opens
 * with `node:async_hooks` and cannot be imported by a page. It also attributes a
 * whole node to its last model, where an assessment wants the split across all
 * of them. Formatting is the shared `formatTokens`/`formatGbp`.
 */
export type RunCost = {
  input: number;
  output: number;
  reasoning: number;
  cached: number;
  total: number;
  cash: number | null;
  calls: number;
  models: { model: string; calls: number; input: number; output: number }[];
};

type UsageRow = { model?: unknown; tokensInput?: unknown; tokensOutput?: unknown; reasoningTokens?: unknown; cacheReadTokens?: unknown; costUsd?: unknown };

export function runCost(calls: { model?: string | null; usage?: unknown }[]): RunCost {
  const cost: RunCost = { input: 0, output: 0, reasoning: 0, cached: 0, total: 0, cash: null, calls: 0, models: [] };
  const byModel = new Map<string, { model: string; calls: number; input: number; output: number }>();
  for (const call of calls) {
    const rows = (Array.isArray(call.usage) ? call.usage : []) as UsageRow[];
    if (!rows.length) continue;
    cost.calls++;
    for (const row of rows) {
      const input = num(row.tokensInput);
      const output = num(row.tokensOutput);
      cost.input += input;
      cost.output += output;
      cost.reasoning += num(row.reasoningTokens);
      cost.cached += num(row.cacheReadTokens);
      // A reported price of null means "no cash changed hands", which is not the
      // same as zero and must not turn `cash` from null into 0.
      if (typeof row.costUsd === 'number' && Number.isFinite(row.costUsd)) cost.cash = (cost.cash ?? 0) + row.costUsd;
      const name = typeof row.model === 'string' && row.model ? row.model : call.model ?? 'model not reported';
      const seen = byModel.get(name) ?? { model: name, calls: 0, input: 0, output: 0 };
      seen.calls++; seen.input += input; seen.output += output;
      byModel.set(name, seen);
    }
  }
  cost.total = cost.input + cost.output;
  cost.models = [...byModel.values()].sort((a, b) => b.input + b.output - (a.input + a.output));
  return cost;
}

/**
 * The interplay map: who is coming for what.
 *
 * The actor board answers "who is in the room" and the playbook answers "what
 * could they do", and between them a reader still has to hold the join in their
 * head — that three different bodies are all attacking the same measure, or that
 * one actor's reach covers half the machinery. That join is the whole point of a
 * game-theoretic read, and it is already in the data: every exploitation play
 * names the actor that runs it and the mechanisms and measures it defeats.
 *
 * Nothing is scored here that the assessment did not score. An arc's weight is
 * the play's own exposure and a target's rank is the sum of what is aimed at it.
 */
export type InterplayActor = { actor: Artefact; plays: number; worst: number; reach: number };
export type InterplayTarget = { id: string; label: string; kind: string; artefact: Artefact | null; incoming: number; pressure: number };
export type InterplayLink = { actorId: string; targetId: string; playId: string; label: string; exposure: number; band: Band };
export type Interplay = { actors: InterplayActor[]; targets: InterplayTarget[]; links: InterplayLink[]; hidden: number };

/** A map with forty targets is a hairball; the tail is counted, not drawn. */
export const INTERPLAY_TARGETS = 12;

export function interplay(artefacts: Artefact[], list: Play[]): Interplay {
  const byId = new Map(artefacts.map((a) => [a.id, a]));
  const links: InterplayLink[] = [];
  for (const play of list) {
    const actorId = play.actor?.id;
    if (!actorId) continue;
    const targets = Array.isArray(play.artefact.data.targets) ? (play.artefact.data.targets as unknown[]).filter((t): t is string => typeof t === 'string') : [];
    for (const targetId of new Set(targets)) {
      links.push({ actorId, targetId, playId: play.artefact.id, label: play.artefact.label, exposure: play.exposure, band: play.band });
    }
  }

  const targets = [...new Set(links.map((l) => l.targetId))].map((id) => {
    const mine = links.filter((l) => l.targetId === id);
    const artefact = byId.get(id) ?? null;
    return {
      id, artefact,
      label: artefact?.label ?? 'A target no longer in the assessment',
      kind: artefact?.kind ?? 'unknown',
      incoming: mine.length,
      pressure: mine.reduce((n, l) => n + l.exposure, 0),
    };
  }).sort((a, b) => b.pressure - a.pressure || b.incoming - a.incoming || a.label.localeCompare(b.label));

  const shown = targets.slice(0, INTERPLAY_TARGETS);
  const keep = new Set(shown.map((t) => t.id));
  const drawn = links.filter((l) => keep.has(l.targetId));

  const actors = [...new Set(drawn.map((l) => l.actorId))].map((id) => {
    const mine = drawn.filter((l) => l.actorId === id);
    return {
      actor: byId.get(id) as Artefact,
      plays: new Set(mine.map((l) => l.playId)).size,
      worst: Math.max(...mine.map((l) => l.exposure)),
      reach: new Set(mine.map((l) => l.targetId)).size,
    };
  }).filter((a) => a.actor).sort((a, b) => b.reach - a.reach || b.worst - a.worst || a.actor.label.localeCompare(b.actor.label));

  return { actors, targets: shown, links: drawn, hidden: targets.length - shown.length };
}

/**
 * A scenario, beat by beat.
 *
 * The contract already holds a sequence — the condition changes, one actor moves
 * first, that produces downstream effects, those land on named outcomes, and
 * somebody may or may not notice. Rendered as a paragraph it reads as an
 * observation; stepped through, it reads as the thing it is, which is a story
 * about behaviour under a condition the policy has to survive.
 */
export type Beat = { key: string; label: string; body: string; refs: string[] };

export function scenarioBeats(scenario: Artefact, artefacts: Artefact[]): Beat[] {
  const byId = new Map(artefacts.map((a) => [a.id, a]));
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const named = (ids: string[]) => ids.map((id) => byId.get(id)?.label).filter((l): l is string => Boolean(l));
  const d = scenario.data;
  const first = typeof d.firstActor === 'string' ? byId.get(d.firstActor) : null;
  const beats: Beat[] = [];
  const push = (key: string, label: string, body: unknown, refs: string[] = []) => {
    const text = String(body ?? '').trim();
    if (text) beats.push({ key, label, body: text, refs });
  };

  push('condition', 'The condition changes', d.changedConditions);
  push('first', first ? `${first.label} moves first` : 'The first move', d.strategy, first ? [first.id] : []);
  for (const [i, effect] of strings(d.downstreamEffects).slice(0, 6).entries()) push(`effect-${i}`, i === 0 ? 'And then' : 'Which in turn', effect);
  const hit = named(strings(d.affectedOutcomes));
  if (hit.length) push('outcomes', 'What it lands on', hit.join(' · '), strings(d.affectedOutcomes));
  push('detect', 'Would anyone see it?', d.detectability);
  push('correct', 'What would correct it', d.correction);
  const weak = strings(d.weaknesses);
  if (weak.length) push('weak', 'Where the policy is weak here', weak.join(' '));
  const sensitivity = strings(d.sensitivity);
  if (sensitivity.length) push('sensitivity', 'What changes the answer', sensitivity.join(' '));
  return beats;
}
