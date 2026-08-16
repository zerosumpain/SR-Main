// src/lib/toolpolicy/publish-input.ts
//
// Validate an OWNER-authored tool-policy version before it is published.
//
// Until now only the engine could publish: `optimise.ts` picks a repeat
// pattern, writes one description overlay, and puts it on trial. The owner
// could only LIST versions and REVERT to one — there was no way to say "try
// promoting these four tools and measure it", which is the single biggest
// lever the overlay has and the one the engine never reaches for, because
// `promoteToEssential` is not something a description-rewriting prompt emits.
//
// The guards here are the ones `optimise.ts` learned the hard way, applied to
// a human (or an agent acting for one) instead of to a model:
//
//   - a name that is not in the registry is rejected, not silently dropped.
//     A promoted name that does not resolve costs manifest tokens forever and
//     surfaces nothing.
//   - promoting something already hardcoded in ESSENTIAL_TOOL_NAMES is
//     rejected as a no-op rather than accepted and ignored.
//   - a rationale is required. Every version shows on the ledger and feeds the
//     next night's context; "test" tells the next reader nothing.

import { sanitiseOverrides, type PublishInput, type ToolOverride } from './policy';
import { ESSENTIAL_TOOL_NAMES } from '$lib/mcp/essentials';

/** Mirrors the cap `publishPolicy` applies, so the caller is told rather than
 *  silently truncated at write time. */
export const MAX_PROMOTIONS = 8;

export type OwnerPublishResult =
  | { ok: true; input: Omit<PublishInput, 'baseline'> }
  | { ok: false; error: string };

/**
 * Coerce and check a publish request body.
 *
 * `registered` is every tool name the registry currently knows. Passed in
 * rather than imported so this stays a pure function — the registry populates
 * itself by import side effect, which a unit test should not have to boot.
 */
export function coerceOwnerPublish(raw: unknown, registered: Set<string>): OwnerPublishResult {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const rationale = typeof body.rationale === 'string' ? body.rationale.trim() : '';
  if (!rationale) {
    return { ok: false, error: '`rationale` is required — it is what the ledger and the next night\'s run read.' };
  }

  const promoteRaw = body.promoteToEssential;
  const promote: string[] = [];
  if (promoteRaw !== undefined) {
    if (!Array.isArray(promoteRaw)) {
      return { ok: false, error: '`promoteToEssential` must be an array of registered tool names.' };
    }
    const unknown: string[] = [];
    const alreadyEssential: string[] = [];
    for (const entry of promoteRaw) {
      const name = typeof entry === 'string' ? entry.trim() : '';
      if (!name) continue;
      if (!registered.has(name)) { unknown.push(name); continue; }
      // Not a silent skip: the caller asked for something that already holds,
      // and a version that quietly does nothing is worse than an error.
      if (ESSENTIAL_TOOL_NAMES.has(name)) { alreadyEssential.push(name); continue; }
      if (!promote.includes(name)) promote.push(name);
    }
    if (unknown.length) {
      return { ok: false, error: `Not registered tool(s): ${unknown.join(', ')}. A promoted name that does not resolve costs manifest tokens forever and surfaces nothing.` };
    }
    if (alreadyEssential.length) {
      return { ok: false, error: `Already directly visible, so promoting is a no-op: ${alreadyEssential.join(', ')}.` };
    }
    if (promote.length > MAX_PROMOTIONS) {
      return { ok: false, error: `At most ${MAX_PROMOTIONS} promotions per version (asked for ${promote.length}). Every one costs manifest tokens on every turn.` };
    }
  }

  const overrides = sanitiseOverrides((body.overrides ?? {}) as Record<string, unknown>);
  const unknownOverride = Object.keys(overrides).filter((n) => !registered.has(n));
  if (unknownOverride.length) {
    return { ok: false, error: `Override names no registered tool: ${unknownOverride.join(', ')}.` };
  }

  const globalGuidance = Array.isArray(body.globalGuidance)
    ? body.globalGuidance.filter((g): g is string => typeof g === 'string' && g.trim().length > 0).map((g) => g.trim())
    : [];

  if (!promote.length && !Object.keys(overrides).length && !globalGuidance.length) {
    return { ok: false, error: 'Nothing to publish — supply at least one of `promoteToEssential`, `overrides` or `globalGuidance`.' };
  }

  return {
    ok: true,
    input: {
      rationale,
      ...(typeof body.targetTool === 'string' && body.targetTool.trim() ? { targetTool: body.targetTool.trim() } : {}),
      overrides: overrides as Record<string, ToolOverride>,
      globalGuidance,
      promoteToEssential: promote,
      createdBy: 'owner',
    },
  };
}

/**
 * Does this version change anything that only reaches the model through the
 * MCP **manifest**?
 *
 * Load-bearing operationally. Hermes discovers tools once on connect and
 * re-discovers only on a `notifications/tools/list_changed` notification this
 * server never sends, so:
 *
 *   - per-tool `overrides` on EXTENDED tools go live on the next
 *     `jkai_extended` list/schema call, because `dispatchMetaTool` applies the
 *     policy per call; but
 *   - `promoteToEssential` and `globalGuidance` live only in `listMcpTools()`,
 *     so they sit inert until the gateway reconnects.
 *
 * Publishing one of those without restarting Hermes means the trial measures a
 * change the model never saw, and the engine then reverts it as "no effect" —
 * a false negative written permanently into the ledger. So the API says so.
 */
export function needsHermesReconnect(input: Pick<PublishInput, 'promoteToEssential' | 'globalGuidance'>): boolean {
  return Boolean(input.promoteToEssential?.length) || Boolean(input.globalGuidance?.length);
}
