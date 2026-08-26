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
import type { CallPattern } from './call-efficiency';
import type { Budget } from './run';
import {
  assessActiveTrial,
  formatEfficiency,
  measureEfficiency,
  persistMeasurement,
  snapshotOf,
} from './efficiency';
import { TRIAL, errMsg, parseJsonLoose, type RunAction } from './types';

/** Trim to `max` chars on a word boundary — ledger details and the WhatsApp
 *  summary both render these, and a mid-word cut ("drastical") reads as a bug. */
export function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[.,;:\s]+$/, '')}…`;
}

/** Never advertise these as a cheaper route (mirrors context.ts). */
const UNSAFE_TO_SUGGEST = new Set([
  'create_tool', 'promote_tool', 'delete_tool', 'datastore_delete',
  'datastore_collection_delete', 'blog_delete', 'workflow_delete', 'build_cancel',
]);

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
 * Does the text tell the caller to put MORE THAN ONE value into THIS tool's
 * arguments? That is the only claim a single-value schema cannot honour.
 *
 * Scoped per sentence, and a sentence naming a sibling tool is exempt: "a
 * single call to ha_render_template returns every entity" is both true and the
 * advice we want, while a blanket keyword match rejected it. The first version
 * of this check matched "all … in one call" anywhere in the text, which
 * collided with the prompt's own instruction to answer the whole question in
 * one call — so the model was pushed into phrasing the guard then refused, and
 * two of two attempts died on it.
 */
export function claimsBatching(text: string, siblingNames: string[]): boolean {
  const siblings = siblingNames.map((n) => n.toLowerCase()).filter(Boolean);
  return text
    .split(/[.;\n]+/)
    .some((sentence) => {
      const t = sentence.trim();
      if (!t) return false;
      // Advice about a DIFFERENT tool cannot over-promise this one's schema.
      if (siblings.some((n) => t.includes(n))) return false;
      if (/\b(an? array|arrays|comma-separated|batch(es|ed|ing)?)\b/.test(t)) return true;
      // "pass/accepts/supply … all/multiple/several/a list of …" — a supply verb
      // next to a plurality marker is the shape that over-promises the schema.
      return /\b(pass|passing|supply|provide|send|give|accepts?|takes?|specify|include)\b[^,]{0,60}\b(a list of|lists of|multiple|several|many|all|every|both)\b/.test(
        t,
      );
    });
}

/**
 * Below this share of byte-identical repeats, "stop making redundant calls" is
 * the wrong fix and writing it wastes the night.
 *
 * The first live pick made exactly this mistake: told that `fetch_url` repeated
 * 151 times, the model wrote a careful warning against fetching the same URL
 * twice — when only 1 of those 151 was identical. The 119-call turn was 119
 * DIFFERENT urls. Across all chat patterns duplicates are 15 of 398 repeats
 * (4%), so redundancy advice is almost always aimed at the wrong 4%.
 */
export const LOW_DUPLICATE_SHARE = 0.25;

/** Fraction of a pattern's repeats that were byte-identical calls. */
export function duplicateShare(pattern: Pick<CallPattern, 'repeatCalls' | 'duplicateCalls'>): number {
  if (pattern.repeatCalls <= 0) return 0;
  return pattern.duplicateCalls / pattern.repeatCalls;
}

/** Does the text talk about repeated/identical calls? */
function framesAsRedundancy(text: string): boolean {
  return /\b(redundant|identical|same (url|arguments|args|value|entity|query|parameters)|again|twice|already (fetched|called|retrieved))\b/.test(
    text,
  );
}

/**
 * Does the text offer a way to answer the whole question with fewer DISTINCT
 * calls — naming a sibling tool, or consolidating onto one call?
 */
function offersConsolidation(text: string, siblingNames: string[]): boolean {
  if (siblingNames.some((n) => n && text.includes(n.toLowerCase()))) return true;
  return /\b(one (call|request|page|query)|single (call|request|page|query)|index|table of contents|instead of|rather than|in one go|consolidat)\b/.test(
    text,
  );
}

/**
 * Snake_case identifiers in the text that are not real tools and not one of
 * this tool's own parameters.
 *
 * The overlay is the only thing the model sees about a tool, so a confidently
 * named tool that does not exist is worse than saying nothing: it sends the
 * caller looking for a capability that isn't there. Seen on all three trial
 * runs before this guard existed.
 */
export function unknownToolsNamed(
  text: string,
  knownTools: Set<string>,
  schemaParams: string[],
): string[] {
  const params = new Set(schemaParams.map((p) => p.toLowerCase()));
  const found = text.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [];
  return [...new Set(found)].filter(
    (id) => !knownTools.has(id) && !params.has(id) && id.length > 4,
  );
}

/**
 * Reject an overlay that would not help. Two failure modes, both seen live:
 *
 *   1. It promises what the schema cannot do (an array parameter that isn't
 *      there) — that turns repetition into invalid calls, strictly worse.
 *   2. It only says "don't repeat identical calls" on a pattern whose repeats
 *      are overwhelmingly DISTINCT — true, harmless, and aimed at a few percent
 *      of the waste, so it burns a 30-turn trial slot to prove nothing.
 *
 * A prompt asking for better is not enough on its own; both of the prompt
 * defects this pipeline has shipped were invisible to tests and to the model.
 */
export function validateOverride(
  override: ToolOverride,
  schema: unknown,
  opts?: {
    pattern?: Pick<CallPattern, 'repeatCalls' | 'duplicateCalls'>;
    siblingNames?: string[];
    knownTools?: Set<string>;
    schemaParams?: string[];
  },
): { ok: boolean; reason?: string } {
  const text = `${override.description ?? ''} ${override.guidance ?? ''}`.toLowerCase();
  if (!text.trim()) return { ok: false, reason: 'empty override' };

  if (claimsBatching(text, opts?.siblingNames ?? []) && !schemaSupportsBatching(schema)) {
    return {
      ok: false,
      reason: 'override promises batching but no parameter accepts an array',
    };
  }

  if (opts?.knownTools) {
    const bogus = unknownToolsNamed(text, opts.knownTools, opts.schemaParams ?? []);
    if (bogus.length) {
      return {
        ok: false,
        reason: `override names tool(s) that do not exist: ${bogus.join(', ')}`,
      };
    }
  }

  if (opts?.pattern) {
    const share = duplicateShare(opts.pattern);
    if (
      share < LOW_DUPLICATE_SHARE &&
      framesAsRedundancy(text) &&
      !offersConsolidation(text, opts.siblingNames ?? [])
    ) {
      return {
        ok: false,
        reason:
          `override only warns against repeated/identical calls, but just ${opts.pattern.duplicateCalls} of ` +
          `${opts.pattern.repeatCalls} repeats were identical (${Math.round(share * 100)}%) — the waste is ` +
          `distinct calls, so it must name a cheaper single call or a sibling tool instead`,
      };
    }
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
 * Candidate tools whose single call might replace many calls to `toolName`.
 *
 * NOT limited to the same toolset — that was a real defect. `fetch_url` is the
 * only tool in the `web` toolset, so same-toolset siblings came back EMPTY
 * while the prompt still demanded the model "name the specific sibling tool".
 * All three trial runs duly invented one (`search_web`, which does not exist;
 * the real tool is `research_web_search`).
 *
 * So: same-toolset tools first, then the best keyword matches from the whole
 * registry. Capped, because the point is a short relevant menu rather than a
 * second copy of the manifest.
 */
export function siblingCandidates(toolName: string, limit = 24): Array<{ name: string; description: string }> {
  try {
    const all = getTools();
    const self = all.find((t) => t.name === toolName);
    if (!self) return [];

    const manifest = getToolsetManifest();
    const owning = manifest.find((ts) => ts.tools.some((t) => t.name === toolName));
    const sameToolset = new Set((owning?.tools ?? []).map((t) => t.name));

    // Score by shared significant words between names/descriptions.
    const words = (s: string) =>
      new Set(
        s
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 3),
      );
    const mine = words(`${self.name} ${self.description ?? ''}`);
    const scored = all
      .filter((t) => t.name !== toolName && !UNSAFE_TO_SUGGEST.has(t.name))
      .map((t) => {
        const theirs = words(`${t.name} ${t.description ?? ''}`);
        let overlap = 0;
        for (const w of theirs) if (mine.has(w)) overlap++;
        return { t, score: overlap + (sameToolset.has(t.name) ? 100 : 0) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map(({ t }) => ({ name: t.name, description: (t.description ?? '').slice(0, 150) }));
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
  dominantlyDistinct: boolean,
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
    (dominantlyDistinct
      ? 'CRITICAL — read the two repeat numbers below before you write anything. Almost NONE of these repeats ' +
        'were the same call made twice: the caller passed a DIFFERENT argument nearly every time. So ' +
        '"do not make redundant calls", "you already fetched that", "calling it twice returns the same data" ' +
        'and any other warning about identical or repeated calls would be TRUE BUT USELESS — it addresses a ' +
        'few percent of the waste and this change will be measured and thrown away. Do NOT write that. Write ' +
        'guidance that removes DISTINCT calls: name the specific SIBLING TOOL (by name) whose single call ' +
        'covers the whole question, or the one well-chosen starting call that makes the rest unnecessary, ' +
        'and say when to reach for it. Never tell the caller to put more than one value into THIS ' +
        "tool's arguments — its schema takes exactly one. Only ever name a tool that appears in the " +
        'SIBLING TOOLS list below, exactly as spelled there; if that list is absent or empty, name no ' +
        'tool at all and give strategy guidance instead.\n\n'
      : '') +
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
    `- of those ${pattern.repeatCalls} repeats, only ${pattern.duplicateCalls} were byte-identical ` +
    `(${Math.round(duplicateShare(pattern) * 100)}%) — the other ${pattern.repeatCalls - pattern.duplicateCalls} ` +
    `passed DIFFERENT arguments\n` +
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
  const siblingPool = siblingCandidates(chosen.tool.name);
  const siblings = siblingPool.map((c) => `- ${c.name} — ${c.description}`);
  const siblingNames = siblingPool.map((c) => c.name);
  // Every registered tool name, so the guard can tell a real suggestion from an
  // invented one, plus this tool's own parameter names (which are snake_case
  // too and must not read as bogus tools).
  const knownTools = new Set(registry.map((t) => t.name));
  const schemaParams = Object.keys(
    ((chosen.tool.parameters as { properties?: Record<string, unknown> } | null)?.properties) ?? {},
  );
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
      siblings,
      duplicateShare(chosen.pattern) < LOW_DUPLICATE_SHARE,
    ),
    { maxTokens: 3000, temperature: 0.2 },
  );

  let spec = coerceOverlay(json);
  if (!spec) {
    actions.push({ kind: 'proposal', detail: `Call policy for ${chosen.tool.name}: model returned no usable overlay` });
    return actions;
  }

  // The model may name a different tool than the one we asked about; the
  // override must land on the tool whose schema we validated, not that one.
  const toOverride = (sp: OverlaySpec): ToolOverride => ({
    ...(sp.description ? { description: sp.description } : {}),
    ...(sp.guidance ? { guidance: sp.guidance } : {}),
  });
  const validate = (o: ToolOverride) =>
    validateOverride(o, chosen.tool.parameters, {
      pattern: chosen.pattern,
      siblingNames,
      knownTools,
      schemaParams,
    });

  let override = toOverride(spec);
  let check = validate(override);

  // One retry with the rejection fed back. The guards below are strict enough
  // that a first-attempt rejection is common, and without a retry that costs
  // the whole night for one bad paragraph.
  if (!check.ok && budget.timeLeftMs() > 30_000) {
    const retry = await budget.call(
      [
        ...buildOverlayMessages(
          chosen.pattern,
          {
            name: chosen.tool.name,
            description: chosen.tool.description ?? '',
            parameters: chosen.tool.parameters,
          },
          batchable,
          priorFailures,
          siblings,
          duplicateShare(chosen.pattern) < LOW_DUPLICATE_SHARE,
        ),
        { role: 'assistant', content: JSON.stringify(spec) },
        {
          role: 'user',
          content:
            `That overlay was REJECTED: ${check.reason}.\n\nWrite a different one that fixes exactly that. ` +
            `Same JSON shape, no prose.`,
        },
      ],
      { maxTokens: 3000, temperature: 0.2 },
    );
    const second = coerceOverlay(retry.json);
    if (second) {
      const secondOverride = toOverride(second);
      const secondCheck = validate(secondOverride);
      if (secondCheck.ok) {
        spec = second;
        override = secondOverride;
        check = secondCheck;
      }
    }
  }

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
        `${clip(spec.rationale, 160)} On trial from ${eff.chat.meanCalls} calls/turn.`,
      story: {
        subject: chosen.tool.name,
        driver:
          `\`${chosen.tool.name}\` was being called over and over inside single conversations — ` +
          `the same tool again and again to settle one question, which is slow and costs tokens.`,
        driverEvidence:
          `${chosen.pattern.repeatCalls} repeated calls across ${chosen.pattern.turns} turn` +
          `${chosen.pattern.turns === 1 ? '' : 's'} (worst single turn: ${chosen.pattern.worstInOneTurn}×)`,
        solution: clip(spec.rationale, 300),
        outcome:
          `Live on trial from a baseline of ${eff.chat.meanCalls} calls per chat turn. ` +
          `It is kept only if that drops by at least 5%.`,
      },
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
