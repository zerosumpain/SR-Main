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
import { upsertRecord } from '$lib/datastore';
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

/** Candidates worth repairing: enabled, used enough to trust the rate, failing too often. */
export function pickRepairTargets(tools: CustomToolHealth[], limit: number): CustomToolHealth[] {
  return tools
    .filter(
      (t) =>
        t.enabled &&
        t.runCount >= WORK_CAPS.repairMinRuns &&
        t.errorRate > WORK_CAPS.repairErrorRateThreshold,
    )
    .sort((a, b) => b.errorCount - a.errorCount)
    .slice(0, limit);
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
  const targets = pickRepairTargets(health, WORK_CAPS.maxToolsRepaired);
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
      });
    } catch (err) {
      const reason = errMsg(err).slice(0, 300);
      await recordRepairAttempt(runId, tool, spec, 'rejected', reason, after.outcomes);
      actions.push({ kind: 'tool_rejected', detail: `${tool.name} (repair): ${reason}` });
    }
  }

  return actions;
}
