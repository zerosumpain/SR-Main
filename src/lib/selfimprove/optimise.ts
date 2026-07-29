// src/lib/selfimprove/optimise.ts
//
// OPTIMISE phase — the prime outcome made actionable.
//
// Build and repair make jkai able to do more. This phase makes it do the same
// with fewer calls, which on the 30-day sample that motivated it was the larger
// prize: 74% of every tool call made was a repeat of a tool already used in the
// same turn (`fetch_url` 119 times in one turn, `ha_render_template` 37 in
// another). None of that is a missing capability. It is the model not knowing
// that the tool in front of it can already do the job in one call.
//
// The phase does three things, in this order:
//
//   1. Measure and persist calls-per-turn (the ledger's headline number).
//   2. Decide any live experiment — keep it or roll it back. This runs BEFORE
//      authoring so a failed change is off the manifest before the next one is
//      considered.
//   3. If nothing is on trial, author ONE new overlay targeting the biggest
//      repeat pattern and publish it on trial.
//
// One experiment at a time is deliberate: two concurrent overlays would make
// the metric unattributable, and an unattributable metric cannot roll anything
// back.

import { getTools, getToolsetManifest } from '$lib/workflows/site-tools/registry';
import {
  getActivePolicy,
  listPolicyVersions,
  publishPolicy,
  sanitiseOverrides,
  type ToolOverride,
} from '$lib/toolpolicy/policy';
import type { CallPattern } from '$lib/server/hermes-sessions';
import type { Budget } from './run';
import {
  assessActiveTrial,
  formatEfficiency,
  measureEfficiency,
  persistMeasurement,
  snapshotOf,
} from './efficiency';
import { TRIAL, errMsg, parseJsonLoose, type RunAction } from './types';

/** Patterns below this many wasted calls aren't worth a prompt-token overlay. */
const MIN_REPEAT_CALLS = 8;

/** Strip the display prefix `getCallEfficiency` adds to resolved sub-tools. */
export function registryName(patternTool: string): string {
  return patternTool.startsWith('jkai:') ? patternTool.slice(5) : patternTool;
}

/**
 * Does this schema have a parameter that accepts many values at once?
 *
 * Load-bearing: the single most useful overlay is "pass every URL in one call",
 * and it is a LIE unless the tool actually takes an array. A description that
 * promises batching a schema can't honour turns every call into a validation
 * error — strictly worse than the repetition it was meant to fix.
 */
export function schemaSupportsBatching(schema: unknown): boolean {
  const props = (schema as { properties?: Record<string, unknown> } | null)?.properties;
  if (!props || typeof props !== 'object') return false;
  return Object.values(props).some((p) => {
    const t = (p as { type?: unknown })?.type;
    return t === 'array' || (Array.isArray(t) && t.includes('array'));
  });
}

/**
 * Reject an overlay that promises what the schema cannot do. Cheap, and it
 * closes the one way this phase could make things worse rather than merely
 * failing to make them better.
 */
export function validateOverride(
  override: ToolOverride,
  schema: unknown,
): { ok: boolean; reason?: string } {
  const text = `${override.description ?? ''} ${override.guidance ?? ''}`.toLowerCase();
  if (!text.trim()) return { ok: false, reason: 'empty override' };
  const claimsBatch = /\b(array|list of|multiple .* at once|all .* in one call|batch)\b/.test(text);
  if (claimsBatch && !schemaSupportsBatching(schema)) {
    return {
      ok: false,
      reason: 'override promises batching but no parameter accepts an array',
    };
  }
  return { ok: true };
}

interface OverlaySpec {
  tool: string;
  description?: string;
  guidance?: string;
  globalGuidance?: string[];
  rationale: string;
}

function coerceOverlay(json: unknown): OverlaySpec | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const tool = typeof o.tool === 'string' ? o.tool : '';
  const description = typeof o.description === 'string' ? o.description : undefined;
  const guidance = typeof o.guidance === 'string' ? o.guidance : undefined;
  if (!tool || (!description && !guidance)) return null;
  return {
    tool,
    description,
    guidance,
    globalGuidance: Array.isArray(o.globalGuidance) ? o.globalGuidance.slice(0, 3).map(String) : [],
    rationale: typeof o.rationale === 'string' ? o.rationale : `Reduce repeated ${tool} calls`,
  };
}

/**
 * Sibling tools in the same toolset, as `name — description` lines.
 *
 * Load-bearing for the non-batchable case, which is the common one: on the
 * sample that motivated this phase NONE of the top four repeat offenders took
 * an array (`fetch_url`, `ha_query_state`, `ha_render_template` and
 * `research_web_search` all take a single string). The only way to collapse 19
 * `ha_query_state` calls is to point at `ha_render_template`, which can return
 * every entity in one call — and the model cannot suggest a tool it was never
 * shown. Without this the phase can only ever say "call it less".
 */
function siblingTools(toolName: string, limit = 25): string[] {
  try {
    const manifest = getToolsetManifest();
    const owning = manifest.find((ts) => ts.tools.some((t) => t.name === toolName));
    if (!owning) return [];
    return owning.tools
      .filter((t) => t.name !== toolName)
      .slice(0, limit)
      .map((t) => `- ${t.name} — ${(t.description ?? '').slice(0, 160)}`);
  } catch {
    return [];
  }
}

function buildOverlayMessages(
  pattern: CallPattern,
  tool: { name: string; description: string; parameters: unknown },
  batchable: boolean,
  priorFailures: string[],
  siblings: string[],
): Array<{ role: 'system' | 'user'; content: string }> {
  const system =
    'You improve how an AI assistant CALLS its existing tools. You are given one tool, its exact input schema, ' +
    'and evidence that the assistant calls it many times inside a single conversational turn. Your job is to ' +
    'rewrite its description so the assistant reaches the same answer in FEWER calls.\n\n' +
    'You may ONLY change description text. You cannot change the tool\'s name, its parameters, or its behaviour — ' +
    'so never describe an argument that is not in the schema.\n\n' +
    (batchable
      ? 'This tool HAS an array parameter, so instructing the caller to pass every value in one call is valid and is ' +
        'almost certainly the right fix. Say so explicitly and unambiguously.\n\n'
      : 'This tool has NO array parameter, so it CANNOT take many values at once. Do not suggest passing an array, ' +
        'a list, or "multiple at once" — that would produce invalid calls. Instead reduce calls another way. In ' +
        'preference order: (a) if one of the SIBLING TOOLS below can answer the whole question in a single call, ' +
        'say so by name and describe exactly when to reach for it instead; (b) tell the caller what one ' +
        'well-chosen call already returns, so they stop probing for it; (c) warn that repeating it with ' +
        'near-identical arguments returns the same data.\n\n') +
    'Respond with ONLY JSON: {"tool": string, "description": string, "guidance": string, ' +
    '"globalGuidance": string[], "rationale": string}. "description" replaces the tool description (keep every ' +
    'capability the original mentions — this text is all the caller sees). "guidance" is one extra sentence ' +
    'appended after it. "globalGuidance" is at most 2 short rules that apply to ALL tools, or []. ' +
    '"rationale" is one line explaining the change. No prose outside the JSON.';

  const user =
    `Tool: ${tool.name}\n` +
    `Current description: ${tool.description}\n\n` +
    `Input schema:\n${JSON.stringify(tool.parameters, null, 2)}\n\n` +
    `Observed waste (last ${TRIAL.windowDays} days, ordinary chat turns only):\n` +
    `- ${pattern.repeatCalls} calls were repeats of this same tool within a turn\n` +
    `- spread over ${pattern.turns} turn(s); the worst single turn called it ${pattern.worstInOneTurn} times\n` +
    `- ${pattern.duplicateCalls} of those were byte-identical repeat calls\n` +
    (siblings.length
      ? `\nSibling tools in the same toolset (a single call to one of these may replace many calls to ${tool.name}):\n${siblings.join('\n')}\n`
      : '') +
    (priorFailures.length
      ? `\nPrevious description changes that were TRIED AND ROLLED BACK for not helping — do not repeat them:\n${priorFailures
          .map((f) => `- ${f}`)
          .join('\n')}\n`
      : '');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Run the phase. Never throws except on budget exhaustion (which run.ts treats
 * as a stop signal) — every other failure degrades to "measured, changed
 * nothing", because a broken optimiser must not cost the run its other phases.
 */
export async function optimiseCalls(budget: Budget, runId: string): Promise<RunAction[]> {
  const actions: RunAction[] = [];

  // ── 1. Measure ────────────────────────────────────────────────────────────
  const eff = await measureEfficiency(TRIAL.windowDays);
  if (!eff) {
    actions.push({
      kind: 'efficiency_measured',
      detail: 'measurement unavailable (Hermes session store unreachable)',
    });
    return actions;
  }
  await persistMeasurement(eff);
  actions.push({ kind: 'efficiency_measured', detail: formatEfficiency(eff) });

  // ── 2. Decide any live experiment ─────────────────────────────────────────
  const { decision, actions: trialActions } = await assessActiveTrial();
  actions.push(...trialActions);
  if (decision.kind === 'waiting') {
    actions.push({
      kind: 'efficiency_measured',
      detail: `trial in progress — ${decision.turnsObserved}/${decision.needed} turns observed (day ${decision.ageDays} of ${TRIAL.maxDays})`,
    });
    // One experiment at a time: publishing now would make neither attributable.
    return actions;
  }

  // ── 3. Author one overlay for the biggest remaining pattern ───────────────
  const registry = getTools();
  const byName = new Map(registry.map((t) => [t.name, t]));

  // Only tools this registry owns can be overlaid — Hermes built-ins
  // (browser_*, terminal, web_search) are not ours to describe.
  const candidates = eff.patterns
    .filter((p) => p.repeatCalls >= MIN_REPEAT_CALLS)
    .map((p) => ({ pattern: p, tool: byName.get(registryName(p.tool)) }))
    .filter((c): c is { pattern: CallPattern; tool: NonNullable<typeof c.tool> } => !!c.tool);

  if (candidates.length === 0) {
    actions.push({
      kind: 'efficiency_measured',
      detail: 'no actionable repeat pattern on an owned tool this cycle',
    });
    return actions;
  }

  // Don't re-target a tool whose last overlay was rolled back — the backlog's
  // lastError pattern, applied to policy: a reverted idea has been tested and
  // failed, so spend the night on the next-biggest pattern instead.
  const history = await listPolicyVersions(30);
  const revertedFor = new Set(
    history.filter((v) => v.trial?.status === 'reverted' && v.targetTool).map((v) => v.targetTool as string),
  );
  const priorFailures = history
    .filter((v) => v.trial?.status === 'reverted')
    .slice(0, 4)
    .map((v) => `${v.targetTool ?? 'unknown'}: ${v.rationale} (${v.trial?.verdict ?? 'reverted'})`);

  const chosen = candidates.find((c) => !revertedFor.has(c.tool.name)) ?? null;
  if (!chosen) {
    actions.push({
      kind: 'efficiency_measured',
      detail: 'every actionable pattern has already been tried and rolled back',
    });
    return actions;
  }

  const batchable = schemaSupportsBatching(chosen.tool.parameters);
  const { json } = await budget.call(
    buildOverlayMessages(
      chosen.pattern,
      {
        name: chosen.tool.name,
        description: chosen.tool.description ?? '',
        parameters: chosen.tool.parameters,
      },
      batchable,
      priorFailures,
      siblingTools(chosen.tool.name),
    ),
    { maxTokens: 3000, temperature: 0.2 },
  );

  const spec = coerceOverlay(json);
  if (!spec) {
    actions.push({ kind: 'proposal', detail: `Call policy for ${chosen.tool.name}: model returned no usable overlay` });
    return actions;
  }

  // The model may name a different tool than the one we asked about; the
  // override must land on the tool whose schema we validated, not that one.
  const override: ToolOverride = {
    ...(spec.description ? { description: spec.description } : {}),
    ...(spec.guidance ? { guidance: spec.guidance } : {}),
  };
  const check = validateOverride(override, chosen.tool.parameters);
  if (!check.ok) {
    actions.push({
      kind: 'tool_rejected',
      detail: `call policy for ${chosen.tool.name}: ${check.reason}`,
    });
    return actions;
  }

  // Carry the current overlay forward — a version is the FULL policy, not a
  // patch, so dropping the existing entries would silently revert kept work.
  const current = await getActivePolicy();
  const overrides = sanitiseOverrides({
    ...current.overrides,
    [chosen.tool.name]: override,
  });

  try {
    const published = await publishPolicy({
      rationale: spec.rationale,
      targetTool: chosen.tool.name,
      overrides,
      globalGuidance: [...current.globalGuidance, ...(spec.globalGuidance ?? [])].slice(0, 6),
      promoteToEssential: current.promoteToEssential,
      createdBy: 'engine',
      baseline: snapshotOf(eff),
    });
    actions.push({
      kind: 'policy_published',
      detail:
        `v${published.version} targets ${chosen.tool.name} ` +
        `(${chosen.pattern.repeatCalls} repeat calls over ${chosen.pattern.turns} turns) — ` +
        `${spec.rationale.slice(0, 160)}. On trial from ${eff.chat.meanCalls} calls/turn.`,
    });
  } catch (err) {
    actions.push({
      kind: 'tool_rejected',
      detail: `call policy publish for ${chosen.tool.name} failed: ${errMsg(err).slice(0, 200)}`,
    });
  }

  return actions;
}

/** Exposed for tests: parse a model overlay response. */
export const __test = { coerceOverlay, parseJsonLoose };
