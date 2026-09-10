import type { Artefact } from './contracts';

// Fitting a stage's context into the model's window without losing the evidence.
//
// The ceiling is 180,000 serialised characters. Targeted research alone can
// exceed it: eight questions, three results each, ten thousand characters of
// retrieved text per result is 240,000 characters before a single claim, actor or
// profile is added. The evidence matrix is the first stage that carries all of
// it, and the shipped code threw `budget` there — a code `worker.ts` excludes
// from retry, so the run ended.
//
// Refusing to run is the worst of the options. Trimming the longest retrieved
// bodies first costs the tail of a source's text; dropping whole artefacts costs
// a line of the assessment. So: clip, in descending order of length, through a
// ladder of caps, and only start dropping artefacts if clipping cannot fit it.
// Either way the caller gets told, in words, what the model did not see.

const CAPS = [8000, 4000, 2000, 1000, 500, 250];

export type Fitted = { artefacts: Artefact[]; notes: string[] };

/** Serialised size of the payload this stage would send. */
export function encodedSize(input: unknown): number {
  return JSON.stringify(input).length;
}

/**
 * Shrink `artefacts` until `build(artefacts)` serialises under `limit`.
 *
 * Clipping is applied to `statement`, which is where retrieved source text and
 * long extracts live; every structured field the contracts depend on is left
 * alone, so nothing a later stage references can disappear through a clip.
 */
export function fitToBudget(artefacts: Artefact[], build: (a: Artefact[]) => unknown, limit: number, protect: Set<string> = new Set()): Fitted {
  const notes: string[] = [];
  if (encodedSize(build(artefacts)) <= limit) return { artefacts, notes };

  let working = artefacts.map((a) => ({ ...a }));
  for (const cap of CAPS) {
    let clipped = 0;
    for (const a of working) {
      if (a.statement.length <= cap) continue;
      a.statement = `${a.statement.slice(0, cap)}\n[…truncated for the model's context window; the full text is retained in this assessment]`;
      clipped++;
    }
    if (clipped) notes.push(`${clipped} long item${clipped === 1 ? '' : 's'} clipped to ${cap.toLocaleString()} characters for this call.`);
    if (encodedSize(build(working)) <= limit) return { artefacts: working, notes: [summarise(notes)] };
  }

  // Still over: shed whole artefacts, retrieved sources first and lowest
  // confidence within that, since those are the ones the stage can most afford.
  // `protect` holds what the call is FOR — the research question's own sources,
  // the actor being profiled. Shedding those would leave a call that reports
  // success having read nothing.
  const order = [...working].sort((a, b) => rank(a, protect) - rank(b, protect));
  const dropped: Artefact[] = [];
  while (order.length > 1 && encodedSize(build(order)) > limit) dropped.push(order.shift()!);
  // Protected items sort last, so reaching one means everything else has already
  // gone. Refusing to shed it here used to leave the payload over the ceiling,
  // and `provider.ts` throws `budget` — a code the worker excludes from retry, so
  // the stage died. A call that ran on nine tenths of what it needed, and says
  // so, is worth more than an assessment that stops. The pinned set is bounded by
  // what the stage is FOR, so this is the tail of a very large policy, not the
  // ordinary case.
  const pinnedLost = dropped.filter((a) => protect.has(a.id));
  if (pinnedLost.length) notes.push(`${pinnedLost.length} item${pinnedLost.length === 1 ? '' : 's'} this call was built around did not fit and were withheld too: ${pinnedLost.slice(0, 6).map((a) => a.label).join(', ')}${pinnedLost.length > 6 ? `, and ${pinnedLost.length - 6} more` : ''}. Read this stage as partial.`);
  if (dropped.length) notes.push(`${dropped.length} item${dropped.length === 1 ? '' : 's'} were withheld from this call entirely: ${dropped.slice(0, 8).map((a) => a.label).join(', ')}${dropped.length > 8 ? `, and ${dropped.length - 8} more` : ''}.`);
  // Losing SOME of a kind costs detail; losing ALL of one costs the reasoning.
  // A list of eight labels never conveyed that — the run where every model, test,
  // scenario and profile was shed reported only the first eight claim labels.
  const gone = [...new Set(dropped.map((a) => a.kind))].filter((kind) => !order.some((a) => a.kind === kind)).sort();
  if (gone.length) notes.push(`No ${gone.join(', ')} was left in this call's context at all; reasoning that depends on ${gone.length === 1 ? 'it' : 'them'} could not be done here.`);
  const kept = working.filter((a) => !dropped.includes(a));
  return { artefacts: kept, notes: [summarise(notes)] };
}

/**
 * Shedding order: the further an artefact sits from the reasoning a stage is
 * doing, the sooner it goes.
 *
 * The shipped ranking put everything except retrieved sources and passages into
 * ONE tier and broke ties on confidence. That is backwards, because a literal
 * extraction from the document is near-certain by construction and a judgement
 * about an actor's incentives is not — so the derived layer always went first.
 *
 * Measured on the first assessment to reach the end (2026-09-10, a 20-page paper
 * yielding 635 artefacts): stages 7, 9, 10 and 12 each ran on claims and evidence
 * with ZERO models, tests, scenarios or assumptions in context. The exploitation
 * playbook — the point of the whole assessment — was written with one of
 * eighteen actor profiles, and that one only because the call pinned it. Asked
 * for conclusions citing results it had never been shown, the model minted
 * plausible identifiers for them, every finding was then quarantined for citing
 * an unavailable source, and synthesis failed reporting the missing chapters
 * rather than the cause.
 *
 * So shed the material a later stage has already consumed and superseded — the
 * retrieved text behind an `evidence` row, the passage behind a `claim` — and
 * keep the conclusions. Confidence remains the tiebreak WITHIN a tier, where it
 * compares like with like.
 */
const SHED_ORDER: Record<string, number> = {
  research_source: 0,
  passage: 1,
  alias: 2,
  resolution_candidate: 2,
  claim: 3,
  evidence: 3,
  node: 3,
  edge: 3,
  actor: 4,
  mechanism: 4,
  profile: 5,
  assumption: 5,
  model: 6,
  test: 6,
  scenario: 6,
  exploit: 6,
  cross_policy: 6,
  finding: 6,
  recommendation: 6,
};

function rank(a: Artefact, protect: Set<string>): number {
  if (protect.has(a.id)) return 1000;
  return (SHED_ORDER[a.kind] ?? 3) * 10 + (a.confidence ?? 0.5) * 9;
}

function summarise(notes: string[]): string {
  return `This call exceeded the model's context window, so its input was reduced. ${notes.join(' ')} Conclusions drawn here rest on less than the full inventory.`;
}
