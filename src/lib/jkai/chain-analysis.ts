// src/lib/jkai/chain-analysis.ts
//
// Read one turn's tool-call CHAIN and say where the calls went.
//
// The self-improvement engine could already see that `apple_calendar_list` was
// called ten times. It could never see that they were ten DIFFERENT calendars,
// or that a `paypal-transactions` integration existed and was skipped while
// fourteen Gmail searches ran — because `optimise.ts` is fed `CallPattern`
// counts (repeats, duplicates, worst-in-one-turn) and a count cannot hold that.
// The chain can. It was simply never read by anything but a person.
//
// Two halves, deliberately split:
//
//   1. `analyseChain` — DETERMINISTIC. Counts discovery steps, finds ladders,
//      finds repeats, finds a batchable schema called one value at a time. No
//      model, no network, no judgement. Every NUMBER a finding reports comes
//      from here.
//   2. `buildAnalysisMessages` / `coerceFindings` — the model's half. It names
//      the cheaper route and writes the rationale. It supplies no numbers, and
//      every tool name it produces is checked against the registry before the
//      finding leaves this module.
//
// That split is the whole safety story, and it is inherited rather than
// invented: `optimise.ts` grew `unknownToolsNamed()` because all three of its
// early trial runs confidently named a tool that does not exist (`search_web`;
// the real one is `research_web_search`). An analyser that reads a chain and
// proposes a fix will reproduce that failure exactly unless the registry gets
// the last word.

import type { ToolTrace, TraceStep } from './tool-trace';

export type ChainFindingKind =
  | 'wrong_source'
  | 'discovery_overhead'
  | 'ladder'
  | 'repeat'
  | 'missed_tool'
  | 'unused_batch';

export type ChainFix = 'overlay' | 'tool_change' | 'prompt';

/** An observation from the deterministic pass. Carries no opinion. */
export interface ChainSignal {
  kind: ChainFindingKind;
  /** Registry name where one is resolvable, else the display name. */
  tool: string;
  calls: number;
  /** Calls whose arguments were byte-identical to an earlier call. */
  identicalCalls: number;
  /** 1-based step positions, for linking a finding back to the row. */
  steps: number[];
  /** What was measured, in one line. Goes to the model verbatim. */
  detail: string;
}

/** A signal the model has explained and routed. */
export interface ChainFinding {
  kind: ChainFindingKind;
  tool: string;
  calls: number;
  /** The floor, if a cheaper route exists. Always >= 1 and < calls. */
  couldHaveBeen: number;
  /** A REGISTERED tool name, or absent. Never a name the model invented. */
  cheaperRoute?: string;
  evidence: string;
  fix: ChainFix;
  rationale: string;
  steps: number[];
}

export interface ChainAnalysis {
  /** Total tool calls in the chain. */
  calls: number;
  /** Calls that only established what tools exist or what shape they take. */
  discoveryCalls: number;
  /** discoveryCalls / calls, 0 when the chain is empty. */
  discoveryShare: number;
  signals: ChainSignal[];
}

/* -------------------------------------------------------------------------- */
/* Deterministic pass                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Tool names that establish what exists rather than answering anything.
 *
 * `jkai_extended` is here conditionally, not by name: `operation:"invoke"` is
 * real work and `operation:"list"|"schema"` is not, and the two arrive under
 * the same tool name. Counting the whole dispatcher as discovery would make
 * every jkai call look like overhead.
 */
const DISCOVERY_TOOLS = new Set(['tool_describe', 'tool_search', 'skill_view', 'skills_list', 'activate_toolset', 'jkai_help']);

/** Never advertise these as a cheaper route (mirrors `optimise.ts`). */
export const UNSAFE_TO_SUGGEST = new Set([
  'create_tool', 'promote_tool', 'delete_tool', 'datastore_delete',
  'datastore_collection_delete', 'blog_delete', 'workflow_delete', 'build_cancel',
]);

/** Below this many calls to one tool, a "pattern" is just a tool being used. */
export const MIN_PATTERN_CALLS = 3;

/**
 * The tool a step actually exercised.
 *
 * A chain records `jkai_extended` for every jkai tool, with the real name
 * inside `args.name`. Reporting a finding against the dispatcher would be
 * useless — there is one of it, and it is never the thing to change.
 */
export function resolveStepTool(step: TraceStep): { tool: string; operation?: string } {
  const raw = step.displayTool || step.tool || '';
  const name = raw.replace(/^mcp[_-]jkai[_-]/, '');
  if (name !== 'jkai_extended') return { tool: name };
  const args = (step.args ?? {}) as { operation?: unknown; name?: unknown };
  const operation = typeof args.operation === 'string' ? args.operation : undefined;
  const inner = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : '';
  return { tool: inner || 'jkai_extended', operation };
}

/** Did this step establish what exists, rather than answer anything? */
export function isDiscoveryStep(step: TraceStep): boolean {
  const raw = (step.displayTool || step.tool || '').replace(/^mcp[_-]jkai[_-]/, '');
  if (DISCOVERY_TOOLS.has(raw)) return true;
  const { operation } = resolveStepTool(step);
  return operation === 'list' || operation === 'schema';
}

/** Stable key for "the same call made again". */
function argsKey(step: TraceStep): string {
  try {
    return JSON.stringify(step.args ?? {});
  } catch {
    return String(step.seq);
  }
}

function argKeySet(step: TraceStep): Set<string> {
  const args = (step.args ?? {}) as Record<string, unknown>;
  // For a jkai dispatch the interesting keys are the INNER tool's, not the
  // wrapper's `operation`/`name`, which are identical on every call.
  const inner = args.args;
  const source = inner && typeof inner === 'object' && !Array.isArray(inner) ? (inner as Record<string, unknown>) : args;
  return new Set(Object.keys(source).filter((k) => source[k] !== undefined && source[k] !== null && source[k] !== ''));
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  if (a.size >= b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

/**
 * A ladder: the same tool called repeatedly, each call carrying strictly more
 * arguments than an earlier one.
 *
 * This is the shape of `apple_calendar_list()` → `({credentialId})` →
 * `({credentialId, calendar, dateRangeStart, dateRangeEnd})`, where the first
 * two calls exist only to discover arguments for the third. It is worth
 * separating from a plain repeat because the fix is different: a ladder is
 * answered by changing the tool's defaults, a repeat by telling the caller
 * about a cheaper single call.
 */
export function isLadder(steps: TraceStep[]): boolean {
  const keySets = steps.map(argKeySet);
  return keySets.some((earlier, i) => keySets.slice(i + 1).some((later) => isSubset(earlier, later)));
}

/** Does any parameter of this schema accept many values at once? */
export function schemaSupportsBatching(schema: unknown): boolean {
  const props = (schema as { properties?: Record<string, unknown> } | null)?.properties;
  if (!props || typeof props !== 'object') return false;
  return Object.values(props).some((p) => {
    const t = (p as { type?: unknown })?.type;
    return t === 'array' || (Array.isArray(t) && t.includes('array'));
  });
}

export interface ToolShape {
  name: string;
  description?: string;
  parameters?: unknown;
}

/**
 * Everything measurable about one chain. Never throws — a malformed step is
 * skipped rather than allowed to take the analysis with it, because this runs
 * behind a button on a page whose job is to explain a turn that already went
 * wrong.
 */
export function analyseChain(trace: ToolTrace, shapes: ToolShape[] = []): ChainAnalysis {
  const steps = Array.isArray(trace?.steps) ? trace.steps : [];
  const byShape = new Map(shapes.map((s) => [s.name, s]));
  const discovery = steps.filter(isDiscoveryStep);

  // Discovery steps are counted ONCE, above. Letting a `schema:gmail_search`
  // also land in the gmail_search group would report "called 4 times" for
  // three searches and one schema fetch — a number that overlaps
  // `discoveryCalls` and overstates the pattern the finding is about.
  const grouped = new Map<string, TraceStep[]>();
  for (const step of steps) {
    if (isDiscoveryStep(step)) continue;
    const { tool } = resolveStepTool(step);
    if (!tool) continue;
    grouped.set(tool, [...(grouped.get(tool) ?? []), step]);
  }

  const signals: ChainSignal[] = [];

  if (steps.length > 0 && discovery.length >= MIN_PATTERN_CALLS) {
    signals.push({
      kind: 'discovery_overhead',
      tool: 'jkai_extended',
      calls: discovery.length,
      identicalCalls: 0,
      steps: discovery.map((s) => s.seq),
      detail:
        `${discovery.length} of ${steps.length} calls only established what tools exist or what arguments they take ` +
        `(${Math.round((discovery.length / steps.length) * 100)}% of the chain).`,
    });
  }

  for (const [tool, group] of grouped) {
    if (group.length < MIN_PATTERN_CALLS) continue;
    const keys = group.map(argsKey);
    const identical = keys.length - new Set(keys).size;
    const ladder = isLadder(group);
    const shape = byShape.get(tool);
    const batchable = shape ? schemaSupportsBatching(shape.parameters) : false;

    signals.push({
      kind: ladder ? 'ladder' : batchable ? 'unused_batch' : 'repeat',
      tool,
      calls: group.length,
      identicalCalls: identical,
      steps: group.map((s) => s.seq),
      detail:
        `${tool} was called ${group.length} times in one turn; ${identical} of those repeated an earlier call ` +
        `byte-for-byte, so ${group.length - identical - 1} passed genuinely different arguments.` +
        (ladder ? ' Each call carried strictly more arguments than an earlier one — a discovery ladder.' : '') +
        (batchable ? ' Its schema HAS an array parameter, so one call could have carried every value.' : ''),
    });
  }

  // Biggest first: a page shows the top of this list and a night's budget
  // spends on the top of this list.
  signals.sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));

  return {
    calls: steps.length,
    discoveryCalls: discovery.length,
    discoveryShare: steps.length ? discovery.length / steps.length : 0,
    signals,
  };
}

/* -------------------------------------------------------------------------- */
/* The model's half                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Tools worth offering as a cheaper route.
 *
 * Scored against the QUESTION rather than against the tool that was called,
 * which is the difference between this and `siblingCandidates` in
 * `optimise.ts`. That one asks "what is like `fetch_url`"; the interesting
 * question here is "what should this have been", and on the 2026-08-16 PayPal
 * turn the right answer (`api_integration_call`) is not remotely like
 * `gmail_search` — it is like the words the user typed.
 */
export function routeCandidates(
  userMessage: string,
  shapes: ToolShape[],
  called: Set<string>,
  limit = 20,
): ToolShape[] {
  const words = new Set(
    userMessage.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3),
  );
  if (!words.size) return [];
  return shapes
    .filter((s) => !called.has(s.name) && !UNSAFE_TO_SUGGEST.has(s.name))
    .map((s) => {
      const haystack = `${s.name} ${s.description ?? ''}`.toLowerCase();
      let score = 0;
      for (const w of words) if (haystack.includes(w)) score += haystack.includes(`${w} `) ? 2 : 1;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
    .slice(0, limit)
    .map((x) => x.s);
}

export function buildAnalysisMessages(
  userMessage: string,
  answer: string,
  analysis: ChainAnalysis,
  candidates: ToolShape[],
): Array<{ role: 'system' | 'user'; content: string }> {
  const system =
    'You review ONE conversational turn of an AI assistant and say where its tool calls went. You are given the ' +
    "user's question, the assistant's answer, and MEASURED facts about the chain of tool calls in between.\n\n" +
    'The numbers are already established. Do not restate, recompute or contradict them — your job is to say WHY ' +
    'each pattern happened and what the cheaper route was.\n\n' +
    'Rules that make a finding usable:\n' +
    '- Only ever name a tool from the CANDIDATE ROUTES list, spelled exactly as it appears there. If none of them ' +
    'would have helped, omit `cheaperRoute` entirely. A confidently named tool that does not exist is worse than ' +
    'saying nothing — it sends the caller looking for a capability that is not there.\n' +
    '- `couldHaveBeen` is how few calls this pattern NEEDED. It must be at least 1 and fewer than `calls`.\n' +
    '- `fix` is where the change belongs: "overlay" when a sharper tool DESCRIPTION would have prevented it, ' +
    '"tool_change" when the tool itself needs different arguments or defaults, "prompt" when nothing about the ' +
    'tools was wrong and the assistant simply chose the wrong source.\n' +
    '- Say what the caller should have done instead, concretely. "Avoid redundant calls" is true of everything and ' +
    'changes nothing.\n\n' +
    'Respond with ONLY JSON: {"findings": [{"kind": string, "tool": string, "couldHaveBeen": number, ' +
    '"cheaperRoute": string | null, "fix": "overlay"|"tool_change"|"prompt", "rationale": string, "evidence": string}]}. ' +
    '`kind` and `tool` must copy a SIGNAL below. Return an empty array if the chain was already efficient. ' +
    'No prose outside the JSON.';

  const signalLines = analysis.signals
    .map((s) => `- kind=${s.kind} tool=${s.tool} calls=${s.calls} identical=${s.identicalCalls} steps=[${s.steps.join(',')}]\n  ${s.detail}`)
    .join('\n');

  const user =
    `USER ASKED:\n${userMessage.slice(0, 2000) || '(not recorded)'}\n\n` +
    `ASSISTANT ANSWERED:\n${answer.slice(0, 1500) || '(not recorded)'}\n\n` +
    `CHAIN: ${analysis.calls} tool calls, of which ${analysis.discoveryCalls} ` +
    `(${Math.round(analysis.discoveryShare * 100)}%) only established what tools exist or what arguments they take.\n\n` +
    `SIGNALS (measured — treat as fact):\n${signalLines || '(none)'}\n\n` +
    (candidates.length
      ? `CANDIDATE ROUTES — registered tools NOT called in this turn whose descriptions match the question. ` +
        `These are the ONLY names you may put in \`cheaperRoute\`:\n` +
        candidates.map((c) => `- ${c.name} — ${(c.description ?? '').slice(0, 180)}`).join('\n')
      : 'CANDIDATE ROUTES: none. Do not name any tool in `cheaperRoute`.');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

const VALID_KINDS = new Set<ChainFindingKind>(['wrong_source', 'discovery_overhead', 'ladder', 'repeat', 'missed_tool', 'unused_batch']);
const VALID_FIXES = new Set<ChainFix>(['overlay', 'tool_change', 'prompt']);

/**
 * Turn the model's JSON into findings, dropping anything unusable.
 *
 * Counts are taken from the matching SIGNAL, never from the model, so a
 * hallucinated `calls: 40` cannot reach the backlog and become the evidence a
 * night's work is spent on. A finding whose `tool` matches no signal is
 * dropped outright rather than repaired — it is about a turn that did not
 * happen.
 */
export function coerceFindings(
  raw: unknown,
  analysis: ChainAnalysis,
  registered: Set<string>,
): ChainFinding[] {
  const list = (raw as { findings?: unknown })?.findings;
  if (!Array.isArray(list)) return [];
  const signalFor = new Map(analysis.signals.map((s) => [`${s.kind}:${s.tool}`, s]));
  const byTool = new Map(analysis.signals.map((s) => [s.tool, s]));

  const out: ChainFinding[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const tool = typeof o.tool === 'string' ? o.tool.trim() : '';
    const kind = typeof o.kind === 'string' ? (o.kind.trim() as ChainFindingKind) : ('repeat' as ChainFindingKind);
    if (!tool || !VALID_KINDS.has(kind)) continue;

    // The model may re-label a signal's kind (a "repeat" it judges a
    // "wrong_source"). That is a legitimate call, so fall back to matching on
    // the tool alone — but a tool with no signal at all is invented.
    const signal = signalFor.get(`${kind}:${tool}`) ?? byTool.get(tool);
    if (!signal) continue;

    const rationale = typeof o.rationale === 'string' ? o.rationale.trim().slice(0, 600) : '';
    if (!rationale) continue;

    const proposed = typeof o.cheaperRoute === 'string' ? o.cheaperRoute.trim() : '';
    const cheaperRoute = proposed && registered.has(proposed) && !UNSAFE_TO_SUGGEST.has(proposed) ? proposed : undefined;

    const asked = Number(o.couldHaveBeen);
    const couldHaveBeen = Number.isFinite(asked)
      ? Math.min(Math.max(1, Math.round(asked)), Math.max(1, signal.calls - 1))
      : Math.max(1, Math.min(2, signal.calls - 1));

    const fix = typeof o.fix === 'string' && VALID_FIXES.has(o.fix as ChainFix) ? (o.fix as ChainFix) : 'overlay';

    out.push({
      kind,
      tool: signal.tool,
      calls: signal.calls,
      couldHaveBeen,
      ...(cheaperRoute ? { cheaperRoute } : {}),
      evidence: (typeof o.evidence === 'string' && o.evidence.trim() ? o.evidence.trim() : signal.detail).slice(0, 600),
      fix,
      rationale,
      steps: signal.steps,
    });
  }

  // Most calls saved first — that is the order both the page and the engine
  // should spend attention in.
  out.sort((a, b) => (b.calls - b.couldHaveBeen) - (a.calls - a.couldHaveBeen));
  return out;
}

/**
 * The backlog item a finding becomes.
 *
 * `kind` maps from where the fix belongs: a tool that needs different
 * arguments is repo code (`feature`), a sharper description is not. Priority
 * rises with the calls saved, because that is the only quantity here that is
 * measured rather than judged.
 *
 * Titles are deliberately stable and tool-scoped — `backlog.ts` dedupes on a
 * slug derived from the title, so the same finding arriving from five traces
 * has to update one row instead of creating five. That was the whole reason
 * the backlog exists.
 */
export function findingToIdea(finding: ChainFinding): {
  title: string;
  detail: string;
  kind: 'tool' | 'feature';
  priority: number;
} {
  const saved = Math.max(0, finding.calls - finding.couldHaveBeen);
  return {
    title: `Reduce ${finding.tool} calls per turn (${finding.kind})`,
    detail:
      `${finding.rationale}\n\n` +
      `Measured: ${finding.calls} calls in one turn, needed about ${finding.couldHaveBeen}.\n` +
      (finding.cheaperRoute ? `Cheaper route: ${finding.cheaperRoute}.\n` : '') +
      `Evidence: ${finding.evidence}\n` +
      `Fix belongs in: ${finding.fix}.`,
    kind: finding.fix === 'tool_change' ? 'feature' : 'tool',
    priority: saved >= 8 ? 1 : saved >= 4 ? 2 : 3,
  };
}
