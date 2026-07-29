// src/lib/selfimprove/toolsmith.ts
//
// BUILD phase — where the engine actually adds functionality.
//
// What this replaced: ONE gateway call proposing ONE tool, one smoke test
// against one sample argument, and — on any failure — a shrug. Across 19–29 Jul
// that produced 3 tools from 6 attempts, every one persisted `enabled: false`
// and therefore never callable. Net new capability: nothing. The three
// rejections (HTTP 405, a 401 needing a credential, a handler that returned
// undefined) were each one feedback round away from working.
//
// What it does now:
//   * draws work from the durable backlog as well as fresh insights,
//   * authors up to WORK_CAPS.maxToolCandidates tools per night,
//   * REPAIRS each one up to maxRepairRounds times with the real failure text
//     fed back into the next call,
//   * verifies with staticScan + a multi-case smoke test (verify.ts),
//   * and SHIPS what passes: enabled + registered live, no restart required.
//
// Auto-enable is the owner's explicit decision (2026-07-29). It is only
// defensible because nothing reaches the registry without clearing verify.ts —
// keep that gate honest.

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
  type BacklogItemData,
  type QuestionInsights,
  type RunAction,
  type ToolAttemptData,
} from './types';
import type { Budget } from './run';
import type { GatheredSignals } from './analyze';
import { buildContextPack, renderContext, type ContextPack } from './context';
import { staticScan, smokeTest, type SmokeCase, type SmokeResult } from './verify';
import { addIdeas, markAttempt, pickWork } from './backlog';

const NAME_RE = /^[a-z][a-z0-9_]{2,60}$/;

export interface ToolSpec {
  name: string;
  description: string;
  toolset: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  handler_code: string;
  smoke_cases: SmokeCase[];
}

interface ToolsmithPlan {
  tools: ToolSpec[];
  ideas: Array<{ title: string; detail: string; kind: 'tool' | 'feature'; priority?: number }>;
}

// ---------------------------------------------------------------------------
// Prompting
// ---------------------------------------------------------------------------

const HANDLER_RULES = [
  'handler_code is the BODY of an async JavaScript function with `args`, `fetch` and `platform` in scope.',
  'It MUST return { success: boolean, data?: any, error?: string } on every path — including error paths.',
  'Prefer platform.call("api_call", { api: "<catalogued API name>", path: "/…", method: "GET" }) over raw fetch:',
  '  those calls are SSRF-guarded and can use owner credentials you are not allowed to see.',
  'Raw fetch is allowed ONLY for public, no-auth, documented HTTPS endpoints.',
  'FORBIDDEN and automatically rejected: process, require(), import(), eval, Function(), .constructor(),',
  '  globalThis, fs, child_process, __dirname, setInterval. Never read env vars or secrets.',
  'Check response.ok and handle non-200 before parsing JSON. Verify the HTTP METHOD the endpoint expects.',
  'Provide 2-3 smoke_cases with REAL arguments that must all succeed — they are executed for real.',
].join('\n');

function buildAuthorMessages(
  insights: QuestionInsights | undefined,
  pack: ContextPack,
  work: BacklogItemData[],
  count: number,
): Array<{ role: 'system' | 'user'; content: string }> {
  const system =
    'You are the tool-smith for a personal AI assistant ("jkai") owned by one technical user. ' +
    `Design up to ${count} SMALL, GENUINELY USEFUL runtime tools that make the assistant able to answer ` +
    'questions it currently cannot, and propose further ideas for the backlog.\n\n' +
    'Favour tools that compose the platform and catalogued APIs listed below over generic internet toys. ' +
    "A tool that reads the owner's own data or a catalogued API is worth ten timezone converters.\n\n" +
    HANDLER_RULES +
    '\n\nRespond with ONLY JSON: {"tools": [{"name": snake_case, "description": string, "toolset": string, ' +
    '"parameters": {"type":"object","properties":{...},"required":[...]}, "handler_code": string, ' +
    '"smoke_cases": [{"args": {...}}]}], "ideas": [{"title": string, "detail": string, ' +
    '"kind": "tool"|"feature", "priority": 1-5}]}. ' +
    'Use "feature" for ideas that need real repository code rather than a runtime tool. No prose outside the JSON.';

  const sections = [renderContext(pack)];

  if (work.length) {
    sections.push(
      '\n## Backlog items to build FIRST (queued on previous nights)\n' +
        work
          .map(
            (w) =>
              `- ${w.title}: ${w.detail}` +
              (w.attempts > 0
                ? `\n  PREVIOUS ATTEMPT #${w.attempts} FAILED: ${w.lastError ?? 'unknown'} — take a different approach.`
                : ''),
          )
          .join('\n'),
    );
  }

  sections.push(
    '\n## Recent question intents and unmet needs\n' +
      JSON.stringify(
        { intents: (insights?.intents ?? []).slice(0, 10), topUnmet: insights?.topUnmet ?? [] },
        null,
        2,
      ),
  );

  return [
    { role: 'system', content: system },
    { role: 'user', content: sections.join('\n') },
  ];
}

/** Repair prompt: same tool, the real failure, fix it. */
function buildRepairMessages(
  spec: ToolSpec,
  failure: string,
  pack: ContextPack,
): Array<{ role: 'system' | 'user'; content: string }> {
  const system =
    'You are debugging a runtime tool you just wrote. It FAILED verification. Diagnose the actual cause and ' +
    'return a corrected version. Do not restate the same approach — if an endpoint returned 404/405 the URL or ' +
    'HTTP method is wrong; if authentication failed, route the call through a catalogued API with a credential ' +
    'handle instead; if the handler returned undefined, make every path return the result object.\n\n' +
    HANDLER_RULES +
    '\n\nRespond with ONLY JSON: {"name": string, "description": string, "toolset": string, ' +
    '"parameters": {...}, "handler_code": string, "smoke_cases": [{"args": {...}}]}. No prose outside the JSON.';

  const user =
    `Tool: ${spec.name}\nDescription: ${spec.description}\n\n` +
    `Current handler_code:\n${spec.handler_code}\n\n` +
    `Smoke cases: ${JSON.stringify(spec.smoke_cases)}\n\n` +
    `FAILURE:\n${failure}\n\n` +
    `Platform reference:\n${renderContext(pack)}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

export function coerceSpec(raw: unknown): ToolSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const handler_code = typeof o.handler_code === 'string' ? o.handler_code : '';
  const params =
    o.parameters && typeof o.parameters === 'object' ? (o.parameters as ToolSpec['parameters']) : null;
  if (!NAME_RE.test(name) || !handler_code || !params) return null;

  const casesRaw = Array.isArray(o.smoke_cases) ? o.smoke_cases : [];
  const smoke_cases: SmokeCase[] = casesRaw
    .map((c): SmokeCase | null => {
      const co = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
      const args = co.args && typeof co.args === 'object' ? (co.args as Record<string, unknown>) : null;
      return args ? { args, label: typeof co.label === 'string' ? co.label : undefined } : null;
    })
    .filter((c): c is SmokeCase => c !== null)
    .slice(0, 4);

  // A tool with no executable case cannot be verified, so it must not ship. Only
  // fall back to an empty-args case when the schema genuinely requires nothing.
  if (smoke_cases.length === 0) {
    const required = Array.isArray(params.required) ? params.required : [];
    if (required.length > 0) return null;
    smoke_cases.push({ args: {} });
  }

  return {
    name,
    description: typeof o.description === 'string' ? o.description : name,
    toolset: typeof o.toolset === 'string' && o.toolset ? o.toolset : 'self-improve',
    parameters: { type: 'object', properties: params.properties ?? {}, required: params.required },
    handler_code,
    smoke_cases,
  };
}

function coercePlan(json: unknown): ToolsmithPlan {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  // Accept the legacy single-`tool` shape too — the model sometimes reverts to it.
  const toolsRaw = Array.isArray(o.tools) ? o.tools : o.tool ? [o.tool] : [];
  const tools = toolsRaw
    .map(coerceSpec)
    .filter((t): t is ToolSpec => t !== null)
    .slice(0, WORK_CAPS.maxToolCandidates);

  const ideasRaw = Array.isArray(o.ideas) ? o.ideas : [];
  const ideas = ideasRaw
    .map((i) => {
      const io = (i && typeof i === 'object' ? i : {}) as Record<string, unknown>;
      const title = typeof io.title === 'string' ? io.title : '';
      if (!title) return null;
      return {
        title,
        detail: typeof io.detail === 'string' ? io.detail : '',
        kind: io.kind === 'feature' ? ('feature' as const) : ('tool' as const),
        priority: typeof io.priority === 'number' ? io.priority : 3,
      };
    })
    .filter((i): i is NonNullable<typeof i> => i !== null)
    .slice(0, 6);

  return { tools, ideas };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function recordAttempt(
  runId: string,
  spec: ToolSpec,
  status: 'created' | 'rejected',
  extra: Partial<ToolAttemptData> = {},
): Promise<void> {
  const data: ToolAttemptData = {
    runId,
    name: spec.name,
    description: spec.description,
    toolset: spec.toolset,
    status,
    handlerCode: spec.handler_code,
    parameters: spec.parameters as unknown as Record<string, unknown>,
    sampleArgs: spec.smoke_cases[0]?.args ?? {},
    attemptedAt: new Date().toISOString(),
    mode: 'create',
    ...extra,
  };
  try {
    // Key includes the round so a repair sequence is fully readable in the ledger.
    const key = `${runId}:${spec.name}${extra.round ? `:r${extra.round}` : ''}`;
    await upsertRecord(COLLECTIONS.toolAttempts, { key, data: asData(data) }, SYSTEM_ACTOR);
  } catch (err) {
    console.error('[selfimprove] recordAttempt failed:', errMsg(err));
  }
}

// ---------------------------------------------------------------------------
// Verify-and-ship for a single candidate
// ---------------------------------------------------------------------------

interface AttemptOutcome {
  shipped: boolean;
  failure?: string;
  smoke?: SmokeResult;
}

/**
 * Static-scan, register in-memory, smoke-test. On success the registration is
 * KEPT — that is what makes the tool live without a restart — and the row is
 * written `enabled: true` so it survives the next boot.
 */
async function verifyAndShip(spec: ToolSpec): Promise<AttemptOutcome> {
  const scan = staticScan(spec.handler_code);
  if (!scan.ok) {
    return { shipped: false, failure: `static scan rejected the handler: ${scan.violations.join('; ')}` };
  }

  const { register, unregister, isRegisteredTool } = await import(
    '$lib/workflows/site-tools/registry-internal'
  );
  const { buildHandler } = await import('$lib/workflows/site-tools/custom-tool-loader');
  const { executeTool } = await import('$lib/workflows/site-tools/registry');

  if (isRegisteredTool(spec.name) || (await toolNameExists(spec.name))) {
    return { shipped: false, failure: `a tool named "${spec.name}" already exists — choose a different name` };
  }

  let registered = false;
  try {
    register({
      name: spec.name,
      description: spec.description,
      toolset: spec.toolset,
      parameters: spec.parameters,
      category: 'Custom Tool',
      handler: buildHandler(spec.name, spec.handler_code),
    });
    registered = true;

    const smoke = await smokeTest(spec.smoke_cases, (args) => executeTool(spec.name, args));
    if (!smoke.ok) {
      unregister(spec.name);
      return { shipped: false, failure: smoke.failureSummary, smoke };
    }

    await db.insert(customTools).values({
      name: spec.name,
      description: spec.description,
      toolset: spec.toolset,
      parameters: spec.parameters,
      handlerCode: spec.handler_code,
      createdBy: 'self-improvement',
      enabled: true,
    });
    return { shipped: true, smoke };
  } catch (err) {
    if (registered) unregister(spec.name);
    return { shipped: false, failure: errMsg(err).slice(0, 500) };
  }
}

/** True when a `custom_tools` row already holds this name. */
export async function toolNameExists(name: string): Promise<boolean> {
  try {
    const [row] = await db.select().from(customTools).where(eq(customTools.name, name)).limit(1);
    return !!row;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// BUILD
// ---------------------------------------------------------------------------

/** BUILD: author, repair, verify and ship runtime tools; queue what it cannot build. */
export async function buildTool(
  insights: QuestionInsights | undefined,
  _signals: GatheredSignals | undefined,
  budget: Budget,
  runId: string,
): Promise<RunAction[]> {
  const actions: RunAction[] = [];

  const pack = await buildContextPack();
  const work = pickWork(pack.backlog, 'tool', WORK_CAPS.maxToolCandidates);

  const { json } = await budget.call(
    buildAuthorMessages(insights, pack, work, WORK_CAPS.maxToolCandidates),
    { maxTokens: 8000, temperature: 0.4 },
  );
  const plan = coercePlan(json);

  // Queue ideas first — a night that ships nothing must still leave the backlog
  // richer than it found it.
  if (plan.ideas.length) {
    const added = await addIdeas(plan.ideas);
    for (const slug of added) actions.push({ kind: 'backlog_added', detail: slug });
  }

  if (plan.tools.length === 0) {
    actions.push({ kind: 'proposal', detail: 'No buildable tool proposed this run' });
    return actions;
  }

  for (const candidate of plan.tools) {
    if (budget.timeLeftMs() < WORK_CAPS.reserveWallMs) {
      actions.push({ kind: 'proposal', detail: `Stopped building at "${candidate.name}" — wall-clock budget` });
      break;
    }

    let spec = candidate;
    let outcome = await verifyAndShip(spec);
    let round = 0;

    // Repair loop — the real failure text goes straight back to the model.
    while (!outcome.shipped && round < WORK_CAPS.maxRepairRounds) {
      if (budget.timeLeftMs() < WORK_CAPS.reserveWallMs) break;
      await recordAttempt(runId, spec, 'rejected', {
        reason: outcome.failure,
        round,
        cases: outcome.smoke?.outcomes,
      });
      round++;
      const { json: fixJson } = await budget.call(
        buildRepairMessages(spec, outcome.failure ?? 'unknown failure', pack),
        { maxTokens: 6000, temperature: 0.3 },
      );
      const fixed = coerceSpec(fixJson);
      if (!fixed) break;
      // Keep the original name so the ledger tracks one tool across rounds.
      spec = { ...fixed, name: spec.name };
      outcome = await verifyAndShip(spec);
    }

    // Attribute the outcome to the backlog item that inspired it, when there is one.
    const related = work.find(
      (w) =>
        w.slug === spec.name ||
        spec.description.toLowerCase().includes(w.title.toLowerCase().slice(0, 20)),
    );

    if (outcome.shipped) {
      await recordAttempt(runId, spec, 'created', {
        shipped: true,
        round,
        cases: outcome.smoke?.outcomes,
      });
      actions.push({
        kind: 'tool_shipped',
        detail:
          `${spec.name}: ${spec.description} — live now` +
          (round > 0 ? ` (fixed after ${round} repair round${round > 1 ? 's' : ''})` : ''),
      });
      if (related) await markAttempt(related, { status: 'shipped', runId });
    } else {
      await recordAttempt(runId, spec, 'rejected', {
        reason: outcome.failure,
        round,
        cases: outcome.smoke?.outcomes,
      });
      actions.push({
        kind: 'tool_rejected',
        detail: `${spec.name}: ${(outcome.failure ?? 'failed verification').slice(0, 200)}`,
      });
      if (related) {
        await markAttempt(related, { status: 'open', error: outcome.failure, runId });
      } else {
        // Unqueued failure — remember it so tomorrow resumes rather than reinvents.
        await addIdeas([
          {
            title: spec.description.slice(0, 120) || spec.name,
            detail: `Failed as tool "${spec.name}": ${(outcome.failure ?? '').slice(0, 400)}`,
            kind: 'tool',
            priority: 3,
          },
        ]);
      }
    }
  }

  return actions;
}
