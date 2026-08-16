// src/lib/selfimprove/repair.ts
//
// REPAIR phase — fixing what already exists.
//
// The engine could always see that `reverse_geocode` was failing 398 of 572
// calls (70%), and on 28 Jul it even listed "Fix reverse_geocode high error
// rate" as an unmet need. It had no way to act on that: the pipeline could only
// CREATE tools. The single highest-value improvement available to it every
// night was a repair it was architecturally unable to make.
//
// Now: pick the worst-performing enabled custom tool, author a replacement
// handler, and run BOTH handlers against the same smoke cases. The new one is
// swapped in only if it strictly beats the incumbent. The previous handler is
// kept on the attempt record for rollback.

import { db } from '$lib/db';
import { customTools } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { queryRecords, upsertRecord } from '$lib/datastore';
import {
  COLLECTIONS,
  SYSTEM_ACTOR,
  WORK_CAPS,
  asData,
  errMsg,
  type RunAction,
  type ToolAttemptData,
} from './types';
import type { Budget } from './run';
import { buildContextPack, loadCustomToolHealth, renderContext, type CustomToolHealth } from './context';
import { passCount, smokeTest, staticScan, type SmokeCase } from './verify';

/**
 * Tools whose repair was rejected recently enough to still be on cooldown.
 *
 * Reads the attempt ledger this phase already writes, so there is no new state
 * to keep in step. Never throws — a datastore that is down must cost the phase
 * its cooldown, not its run.
 */
export async function recentlyFailedRepairs(
  now: Date = new Date(),
  days: number = WORK_CAPS.repairCooldownDays,
): Promise<Set<string>> {
  const since = now.getTime() - days * 24 * 60 * 60 * 1000;
  const out = new Set<string>();
  try {
    const { records } = await queryRecords(
      COLLECTIONS.toolAttempts,
      // Sorted on `updatedAt` because the datastore only orders by its own
      // columns; the window is then checked against the record's own
      // `attemptedAt`, which is the timestamp that actually means "when this
      // repair was tried".
      { sort: { field: 'updatedAt', dir: 'desc' }, limit: 200 },
      SYSTEM_ACTOR,
    );
    for (const record of records) {
      const data = record.data as unknown as Partial<ToolAttemptData>;
      if (data?.mode !== 'repair' || data.status !== 'rejected') continue;
      const at = Date.parse(String(data.attemptedAt ?? ''));
      if (Number.isFinite(at) && at >= since && data.name) out.add(String(data.name));
    }
  } catch (err) {
    console.error('[selfimprove] recentlyFailedRepairs failed; no cooldown applied:', errMsg(err));
  }
  return out;
}

/**
 * Candidates worth repairing: enabled, used enough to trust the rate, failing
 * too often — and not already tried and rejected this week.
 *
 * The cooldown is the load-bearing part. Sorting by error COUNT with no memory
 * of past attempts is a deterministic loop: a rejected repair leaves the tool
 * untouched, so it is still the worst tool tomorrow night and gets re-authored
 * again. Measured on 2026-08-16, `reverse_geocode` and `reverse_geocode_osm`
 * were picked every night for eight consecutive nights — 31 lifetime attempts,
 * 1 ship — while `nearby_places` sat third of three eligible tools and was
 * never reached, because only two are repaired per night.
 *
 * `optimise.ts` already learned this and skips a tool whose last overlay was
 * rolled back, for the same reason: a thing that has been tested and failed
 * should not have tonight spent on it.
 */
export function pickRepairTargets(
  tools: CustomToolHealth[],
  limit: number,
  onCooldown: Set<string> = new Set(),
): CustomToolHealth[] {
  return tools
    .filter(
      (t) =>
        t.enabled &&
        t.runCount >= WORK_CAPS.repairMinRuns &&
        t.errorRate > WORK_CAPS.repairErrorRateThreshold &&
        !onCooldown.has(t.name),
    )
    .sort((a, b) => b.errorCount - a.errorCount)
    .slice(0, limit);
}

/** Eligible but skipped tonight — reported so a quiet phase is explicable. */
export function repairsOnCooldown(tools: CustomToolHealth[], onCooldown: Set<string>): string[] {
  return tools
    .filter(
      (t) =>
        t.enabled &&
        t.runCount >= WORK_CAPS.repairMinRuns &&
        t.errorRate > WORK_CAPS.repairErrorRateThreshold &&
        onCooldown.has(t.name),
    )
    .map((t) => t.name);
}

interface RepairSpec {
  handler_code: string;
  smoke_cases: SmokeCase[];
  notes?: string;
}

function coerceRepair(json: unknown): RepairSpec | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const handler_code = typeof o.handler_code === 'string' ? o.handler_code : '';
  if (!handler_code) return null;
  const casesRaw = Array.isArray(o.smoke_cases) ? o.smoke_cases : [];
  const smoke_cases: SmokeCase[] = casesRaw
    .map((c) => {
      const co = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
      const args = co.args && typeof co.args === 'object' ? (co.args as Record<string, unknown>) : null;
      return args ? { args } : null;
    })
    .filter((c): c is SmokeCase => c !== null)
    .slice(0, 4);
  if (smoke_cases.length === 0) return null;
  return { handler_code, smoke_cases, notes: typeof o.notes === 'string' ? o.notes : undefined };
}

function buildRepairMessages(
  tool: CustomToolHealth,
  parameters: unknown,
  contextText: string,
): Array<{ role: 'system' | 'user'; content: string }> {
  const system =
    'You are repairing an EXISTING runtime tool that fails too often in production. You are given its current ' +
    'handler code, its parameter schema and its live error rate. Work out what makes it fail — a wrong endpoint, ' +
    'a missing User-Agent, unhandled rate limiting, an unchecked response, a missing null guard — and rewrite the ' +
    'handler so it is robust.\n\n' +
    'handler_code is the BODY of an async function with `args`, `fetch` and `platform` in scope and MUST return ' +
    '{ success: boolean, data?: any, error?: string } on every path. For catalogued APIs prefer ' +
    'platform.call("api_call", { api: "<catalogue name>", url: "<FULL url starting with that API\'s baseUrl>", ' +
    'method: "GET" }) — `url` is required and there is no "path" parameter. FORBIDDEN: process, require(), ' +
    'import(), eval, Function(), .constructor(), globalThis, fs, child_process, setInterval.\n\n' +
    'Also supply 2-4 smoke_cases of REAL arguments that a correct implementation must handle SUCCESSFULLY — ' +
    'realistic inputs of the kind the tool is failing on in production. Every case is executed and must return ' +
    'success:true, so do NOT include deliberate error cases (empty values, "does not exist" inputs): they would ' +
    'make a working repair look broken and it would be discarded.\n\n' +
    'Respond with ONLY JSON: {"handler_code": string, "smoke_cases": [{"args": {...}}], "notes": string}. No prose.';

  const user =
    `Tool: ${tool.name}\nDescription: ${tool.description}\n` +
    `Live health: ${tool.runCount} runs, ${tool.errorCount} errors (${(tool.errorRate * 100).toFixed(0)}%)\n\n` +
    `Parameter schema:\n${JSON.stringify(parameters, null, 2)}\n\n` +
    `Current handler_code:\n${tool.handlerCode ?? '(unavailable)'}\n\n` +
    `Platform reference:\n${contextText}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

async function recordRepairAttempt(
  runId: string,
  tool: CustomToolHealth,
  spec: RepairSpec,
  status: 'created' | 'rejected',
  reason: string | undefined,
  cases: ToolAttemptData['cases'],
): Promise<void> {
  const data: ToolAttemptData = {
    runId,
    name: tool.name,
    description: tool.description,
    toolset: 'repair',
    status,
    reason,
    handlerCode: spec.handler_code,
    parameters: {},
    sampleArgs: spec.smoke_cases[0]?.args ?? {},
    attemptedAt: new Date().toISOString(),
    mode: 'repair',
    shipped: status === 'created',
    cases,
    previousHandlerCode: tool.handlerCode,
  };
  try {
    await upsertRecord(
      COLLECTIONS.toolAttempts,
      { key: `${runId}:repair:${tool.name}`, data: asData(data) },
      SYSTEM_ACTOR,
    );
  } catch (err) {
    console.error('[selfimprove] recordRepairAttempt failed:', errMsg(err));
  }
}

/**
 * REPAIR: re-author the worst-performing tools and swap in any replacement that
 * strictly beats the incumbent on identical smoke cases.
 */
export async function repairTools(budget: Budget, runId: string): Promise<RunAction[]> {
  const actions: RunAction[] = [];

  const health = await loadCustomToolHealth(true);
  const onCooldown = await recentlyFailedRepairs();
  const targets = pickRepairTargets(health, WORK_CAPS.maxToolsRepaired, onCooldown);

  // Never a silent skip. A phase that does nothing because every candidate is
  // resting reads identically to a phase that found nothing wrong, and the two
  // want opposite responses from whoever reads the ledger.
  const resting = repairsOnCooldown(health, onCooldown);
  if (resting.length > 0) {
    actions.push({
      kind: 'efficiency_measured',
      detail:
        `repair: ${resting.join(', ')} skipped — a repair was rejected within the last ` +
        `${WORK_CAPS.repairCooldownDays} days, so tonight goes to the next candidate instead.`,
    });
  }
  if (targets.length === 0) return actions;

  const contextText = renderContext(await buildContextPack());

  const { register, unregister } = await import('$lib/workflows/site-tools/registry-internal');
  const { buildHandler } = await import('$lib/workflows/site-tools/custom-tool-loader');

  for (const tool of targets) {
    if (budget.timeLeftMs() < WORK_CAPS.reserveWallMs) break;

    const [row] = await db.select().from(customTools).where(eq(customTools.name, tool.name)).limit(1);
    if (!row) continue;

    const { json } = await budget.call(buildRepairMessages(tool, row.parameters, contextText), {
      maxTokens: 6000,
      temperature: 0.3,
    });
    const spec = coerceRepair(json);
    if (!spec) {
      actions.push({ kind: 'proposal', detail: `Repair for ${tool.name}: model returned no usable handler` });
      continue;
    }

    const scan = staticScan(spec.handler_code);
    if (!scan.ok) {
      const reason = `static scan rejected the repair: ${scan.violations.join('; ')}`;
      await recordRepairAttempt(runId, tool, spec, 'rejected', reason, undefined);
      actions.push({ kind: 'tool_rejected', detail: `${tool.name} (repair): ${reason}` });
      continue;
    }

    // A/B the incumbent and the candidate over the SAME cases. Both run as
    // detached handlers so neither touches the live registry until we decide.
    const oldHandler = buildHandler(`${tool.name}__incumbent`, tool.handlerCode ?? 'return { success: false };');
    const newHandler = buildHandler(`${tool.name}__candidate`, spec.handler_code);

    const before = await smokeTest(spec.smoke_cases, (a) => oldHandler(a));
    const after = await smokeTest(spec.smoke_cases, (a) => newHandler(a));

    if (passCount(after) <= passCount(before)) {
      const reason = `candidate did not beat the incumbent (${passCount(after)}/${spec.smoke_cases.length} vs ${passCount(before)}/${spec.smoke_cases.length})`;
      await recordRepairAttempt(runId, tool, spec, 'rejected', reason, after.outcomes);
      actions.push({ kind: 'tool_rejected', detail: `${tool.name} (repair): ${reason}` });
      continue;
    }

    // Swap it in: persist the new handler and re-register so it is live now.
    try {
      await db
        .update(customTools)
        .set({ handlerCode: spec.handler_code })
        .where(eq(customTools.name, tool.name));

      unregister(tool.name);
      register({
        name: tool.name,
        description: tool.description,
        toolset: row.toolset,
        parameters: row.parameters as { type: 'object'; properties: Record<string, unknown>; required?: string[] },
        category: 'Custom Tool',
        handler: buildHandler(tool.name, spec.handler_code),
      });

      await recordRepairAttempt(runId, tool, spec, 'created', undefined, after.outcomes);
      actions.push({
        kind: 'tool_repaired',
        detail:
          `${tool.name}: ${passCount(before)}→${passCount(after)} of ${spec.smoke_cases.length} smoke cases ` +
          `(was ${(tool.errorRate * 100).toFixed(0)}% errors over ${tool.runCount} runs)` +
          (spec.notes ? ` — ${spec.notes.slice(0, 160)}` : ''),
        story: {
          subject: tool.name,
          mode: 'repair',
          driver:
            `\`${tool.name}\` was failing most of the time it was used, so it was rewritten rather than ` +
            'left in place to keep breaking answers.',
          driverEvidence: `${(tool.errorRate * 100).toFixed(0)}% of its ${tool.runCount} calls errored`,
          solution: spec.notes ? spec.notes.slice(0, 300) : 'Re-authored the tool\'s handler.',
          outcome: `${passCount(before)}→${passCount(after)} of ${spec.smoke_cases.length} smoke cases now pass.`,
          // The counter is cumulative, so the ledger needs the value AT repair
          // time to report "errors since the fix" instead of errors ever.
          runCountAtAction: tool.runCount,
        },
      });
    } catch (err) {
      const reason = errMsg(err).slice(0, 300);
      await recordRepairAttempt(runId, tool, spec, 'rejected', reason, after.outcomes);
      actions.push({ kind: 'tool_rejected', detail: `${tool.name} (repair): ${reason}` });
    }
  }

  return actions;
}
