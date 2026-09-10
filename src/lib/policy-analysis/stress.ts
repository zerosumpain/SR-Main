import type { Artefact } from './contracts';

/**
 * The stress test: fail an assumption and see what the assessment loses.
 *
 * This is the one thing on the page that is a SIMULATION rather than a reading,
 * and it invents nothing to be one. Every link it walks was asserted by the
 * assessment itself and is already enforced: a model and a scenario name the
 * assumptions they rest on, an exploitation play names the preconditions it
 * needs, a finding names its hypotheses and its results, a recommendation names
 * its findings. Failing an assumption is therefore a graph question with a
 * reproducible answer, not a fresh opinion — which is also why it does not cost
 * a model call.
 *
 * The two directions are OPPOSITE and are reported as opposites, because
 * blurring them would be worse than not offering the tool at all:
 *
 * - A conclusion that rests on a false hypothesis loses its footing. It is not
 *   thereby wrong; it is no longer supported by what was cited for it.
 * - A play whose precondition fails is DISARMED. The actor needed that to be
 *   true to run it, so a failed assumption is good news for the policy here and
 *   bad news three lines above.
 *
 * The twelve structural checks are untouched by any of it, and saying so is part
 * of the answer: they walk the relationships the policy itself states, so they
 * are the part of the assessment that does not move when a hypothesis does.
 */

export type Standing = 'holds' | 'weakened' | 'unsupported' | 'disarmed';

export type StressRow = {
  artefact: Artefact;
  standing: Standing;
  /** Plain-language reasons, one per broken support. */
  because: string[];
};

export type StressResult = {
  failed: string[];
  plays: StressRow[];
  models: StressRow[];
  scenarios: StressRow[];
  findings: StressRow[];
  recommendations: StressRow[];
  /** Deterministic checks, which no hypothesis can move. */
  checksHeld: number;
  counts: { plays: number; models: number; scenarios: number; findings: number; recommendations: number; total: number };
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const affected = (row: StressRow) => row.standing !== 'holds';

/** A short name for an artefact inside a reason line. */
const name = (a: Artefact | undefined, fallback: string) => (a ? `“${a.label}”` : fallback);

export function stress(artefacts: Artefact[], failed: Iterable<string>): StressResult {
  const fail = new Set(failed);
  const byId = new Map(artefacts.map((a) => [a.id, a]));
  const of = (kind: string) => artefacts.filter((a) => a.kind === kind);

  const broken = (ids: string[]) => ids.filter((id) => fail.has(id));
  const reason = (ids: string[], verb: string) => ids.map((id) => `${verb} ${name(byId.get(id), 'an assumption no longer in the assessment')}`);

  /** An exploitation play needs its preconditions to hold; failing one takes it off the table. */
  const plays: StressRow[] = of('exploit').map((artefact) => {
    const hit = broken(strings(artefact.data.preconditions));
    return { artefact, standing: hit.length ? 'disarmed' : 'holds', because: reason(hit, 'needs') };
  });

  const restsOn = (artefact: Artefact): StressRow => {
    const hit = broken(strings(artefact.data.assumptions));
    return { artefact, standing: hit.length ? 'unsupported' : 'holds', because: reason(hit, 'rests on') };
  };
  const models: StressRow[] = of('model').map(restsOn);
  const scenarios: StressRow[] = of('scenario').map(restsOn);

  // Second order: a finding may cite a model, scenario or play that has itself
  // stopped standing. Losing every result it cited is a different thing from
  // losing one of four, so they are not collapsed into a single verdict.
  const resultStanding = new Map<string, StressRow>();
  for (const row of [...plays, ...models, ...scenarios]) resultStanding.set(row.artefact.id, row);

  const findings: StressRow[] = of('finding').map((artefact) => {
    const hypotheses = broken(strings(artefact.data.hypothesisIds));
    const results = strings(artefact.data.resultIds);
    const lost = results.filter((id) => affected(resultStanding.get(id) ?? { artefact, standing: 'holds', because: [] }));
    const because = [...reason(hypotheses, 'rests on'), ...lost.map((id) => `cites ${name(byId.get(id), 'a result')}, which no longer stands`)];
    if (!because.length) return { artefact, standing: 'holds', because };
    // Every hypothesis gone, or every result gone, and the conclusion has
    // nothing left that was offered for it.
    const gutted = (hypotheses.length && hypotheses.length === strings(artefact.data.hypothesisIds).length) || (results.length > 0 && lost.length === results.length);
    return { artefact, standing: gutted ? 'unsupported' : 'weakened', because };
  });

  const findingStanding = new Map(findings.map((row) => [row.artefact.id, row]));
  const recommendations: StressRow[] = of('recommendation').map((artefact) => {
    const cited = strings(artefact.data.findingIds);
    const hurt = cited.filter((id) => affected(findingStanding.get(id) ?? { artefact, standing: 'holds', because: [] }));
    if (!hurt.length) return { artefact, standing: 'holds', because: [] };
    const because = hurt.map((id) => `answers ${name(byId.get(id), 'a finding')}, which no longer stands`);
    return { artefact, standing: hurt.length === cited.length ? 'unsupported' : 'weakened', because };
  });

  const counts = {
    plays: plays.filter(affected).length,
    models: models.filter(affected).length,
    scenarios: scenarios.filter(affected).length,
    findings: findings.filter(affected).length,
    recommendations: recommendations.filter(affected).length,
    total: 0,
  };
  counts.total = counts.plays + counts.models + counts.scenarios + counts.findings + counts.recommendations;

  return { failed: [...fail], plays, models, scenarios, findings, recommendations, checksHeld: of('test').length, counts };
}

/**
 * The assumptions worth offering as switches.
 *
 * An assumption nothing cites cannot change anything, and listing it as a lever
 * that does nothing when pulled is a worse answer than leaving it out. Ordered
 * by how much of the assessment turns on it, then by the run's own
 * importance × uncertainty × consequence.
 */
export function leverage(artefacts: Artefact[]): { artefact: Artefact; dependants: number; priority: number }[] {
  const counts = new Map<string, number>();
  for (const a of artefacts) {
    for (const field of ['assumptions', 'preconditions', 'hypothesisIds']) {
      for (const id of strings(a.data[field])) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return artefacts
    .filter((a) => a.kind === 'assumption')
    .map((artefact) => ({
      artefact,
      dependants: counts.get(artefact.id) ?? 0,
      priority: Number(artefact.data.priority) || Number(artefact.data.importance) * Number(artefact.data.uncertainty) * Number(artefact.data.consequence) || 0,
    }))
    .filter((row) => row.dependants > 0)
    .sort((a, b) => b.dependants - a.dependants || b.priority - a.priority || a.artefact.id.localeCompare(b.artefact.id));
}
