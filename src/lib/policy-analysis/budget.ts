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
  while (order.length > 1 && !protect.has(order[0].id) && encodedSize(build(order)) > limit) dropped.push(order.shift()!);
  if (dropped.length && encodedSize(build(order)) > limit) notes.push(`Even after that, the call still exceeded the window; it ran on what was protected.`);
  if (dropped.length) notes.push(`${dropped.length} item${dropped.length === 1 ? '' : 's'} were withheld from this call entirely: ${dropped.slice(0, 8).map((a) => a.label).join(', ')}${dropped.length > 8 ? `, and ${dropped.length - 8} more` : ''}.`);
  const kept = working.filter((a) => !dropped.includes(a));
  return { artefacts: kept, notes: [summarise(notes)] };
}

function rank(a: Artefact, protect: Set<string>): number {
  if (protect.has(a.id)) return 1000;
  const kindWeight = a.kind === 'research_source' ? 0 : a.kind === 'passage' ? 1 : 2;
  return kindWeight * 10 + (a.confidence ?? 0.5) * 9;
}

function summarise(notes: string[]): string {
  return `This call exceeded the model's context window, so its input was reduced. ${notes.join(' ')} Conclusions drawn here rest on less than the full inventory.`;
}
