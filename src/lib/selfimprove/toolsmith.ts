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
  slugifyIdea,
  type BacklogItemData,
  type QuestionInsights,
  type RunAction,
  type ToolAttemptData,
} from './types';
import type { Budget } from './run';
import type { GatheredSignals } from './analyze';
import { buildContextPack, renderContext, type ContextPack } from './context';
import { staticScan, smokeTest, type SmokeCase, type SmokeResult } from './verify';
import { addIdeas, listBacklog, markAttempt, pickWork } from './backlog';
import { findRelatedIdea } from './narrative';

const NAME_RE = /^[a-z][a-z0-9_]{2,60}$/;

export interface ToolSpec {
  name: string;
  description: string;
  toolset: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  handler_code: string;
  smoke_cases: SmokeCase[];
  /**
   * The user need this tool exists to serve, in the model's own words.
   *
   * This is the ROOT DRIVER shown on the plain-English ledger, and the only
   * moment it is cheaply knowable is here, where the need and the code are being
   * decided together. Reconstructing it afterwards means guessing from a tool
   * description written in API terms, which is exactly what the ledger has to
   * label as inferred rather than recorded.
   */
  serves?: string;
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
  'Prefer platform.call over raw fetch for catalogued APIs — those calls are SSRF-guarded and can use owner',
  '  credentials you are not allowed to see. The EXACT shape is:',
  '    platform.call("api_call", { api: "<catalogue name>", url: "<FULL url>", method: "GET" })',
  '  `url` is required and must be a complete URL that STARTS WITH that API\'s baseUrl (there is no "path"',
  '  parameter — passing one fails). Build query strings into `url` yourself.',
  '  It resolves to { success, data?, error? } — check `.success` before using `.data`.',
  'Raw fetch is allowed ONLY for public, no-auth, documented HTTPS endpoints.',
  'FORBIDDEN and automatically rejected: process, require(), import(), eval, Function(), .constructor(),',
  '  globalThis, fs, child_process, __dirname, setInterval. Never read env vars or secrets.',
  'Check response.ok and handle non-200 before parsing JSON. Verify the HTTP METHOD the endpoint expects.',
  'SMOKE CASES: provide 2-3, each with REAL arguments. They are EXECUTED for real and EVERY one must',
  '  return success:true. Supply only happy-path cases. Do NOT include negative, empty, malformed or',
  '  "does-not-exist" arguments to demonstrate error handling — a case that is expected to fail is',
  '  indistinguishable from a broken tool and will cause the whole tool to be rejected.',
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
    // Stated up here as a hard requirement, not only in the schema line below:
    // when it appeared once, at the end, after the JSON shape, the model omitted
    // it on 3 of 3 tools (2026-07-30) and the reason each tool existed had to be
    // recovered by text-matching instead.
    'EVERY tool object MUST include a "serves" field. It is the single most important field after the ' +
    'code itself: it is shown to the owner as the reason the tool exists. Write the user need in one ' +
    'plain-English sentence, COPIED from the unmet needs or backlog items below wherever one applies. ' +
    'Describe the question a person could not get answered — never what the code does. ' +
    'Good: "You could not ask what the front door battery level is." ' +
    'Bad: "Queries Home Assistant entities by ID." A tool without "serves" is incomplete.\n\n' +
    HANDLER_RULES +
    '\n\nRespond with ONLY JSON: {"tools": [{"name": snake_case, "description": string, "toolset": string, ' +
    '"serves": string, "parameters": {"type":"object","properties":{...},"required":[...]}, ' +
    '"handler_code": string, ' +
    '"smoke_cases": [{"args": {...}}]}], "ideas": [{"title": string, "detail": string, ' +
    '"kind": "tool"|"feature", "priority": 1-5}]}. ' +
    '"serves" is REQUIRED on every tool — see the rule above. ' +
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
    'IMPORTANT: if a failing case was a deliberate error/edge case (an empty string, a "does not exist" value), ' +
    'the TOOL is not what is wrong — the case is. Replace it with a realistic happy-path case. Every smoke case ' +
    'must return success:true.\n\n' +
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
    serves: typeof o.serves === 'string' && o.serves.trim() ? o.serves.trim().slice(0, 400) : undefined,
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

/**
 * The plain-English reason a tool was built, for the ledger's DRIVER column.
 *
 * Prefers the need the model was asked to state, falls back to the backlog item
 * it was matched to, and says plainly when neither exists. It never describes
 * what the code does — that is the SOLUTION column, and conflating the two is
 * what made the old ledger unreadable.
 */
function driverSentence(
  spec: ToolSpec,
  related: BacklogItemData | null | undefined,
): string | undefined {
  const need = (spec.serves ?? '').trim().replace(/[.\s]+$/, '');
  if (need) return `${need}.`;
  if (related) return `Queued as an unmet need: ${related.title.replace(/[.\s]+$/, '')}.`;
  // UNDEFINED, not a "nothing was recorded" sentence. The ledger treats any
  // stored driver as `recorded`, so returning prose here would stamp full
  // confidence on a sentence whose own content admits it knows nothing. Leaving
  // it unset lets narrative.ts fall through to matching the tool against the
  // week's unmet needs and label that honestly as `inferred`.
  return undefined;
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

    // Attribute the outcome to the backlog item that inspired it.
    //
    // This used to search only `work` — the items picked BEFORE this run's own
    // ideas were queued — with a matcher that required the tool's description to
    // contain the first 20 characters of the item's title. On 30 Jul it shipped
    // `home_sensor_status` and `govuk_search` while leaving "Real-time home
    // sensor data" and "Up-to-date knowledge on UK government projects" open at
    // attempts:0, so the backlog recorded nothing and would have rebuilt both.
    // Now it searches the whole backlog as it stands after this run's additions,
    // and leads with `serves` — the need in the model's own words.
    const backlogNow = await listBacklog();
    const related =
      backlogNow.find((w) => w.slug === slugifyIdea(spec.serves ?? '')) ??
      findRelatedIdea(`${spec.serves ?? ''} ${spec.description} ${spec.name.replace(/_/g, ' ')}`, backlogNow);

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
        story: {
          subject: spec.name,
          mode: 'create',
          driver: driverSentence(spec, related),
          driverRef: related?.slug,
          driverEvidence: related?.detail?.slice(0, 240),
          solution: spec.description,
          outcome:
            `Passed the safety scan and every smoke case, and was enabled live` +
            (round > 0 ? ` after ${round} repair round${round > 1 ? 's' : ''}` : '') + '.',
          // Snapshot so the ledger can later say "called N times SINCE shipping"
          // rather than quoting a lifetime counter that never resets.
          runCountAtAction: 0,
        },
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
        story: {
          subject: spec.name,
          mode: 'create',
          driver: driverSentence(spec, related),
          driverRef: related?.slug,
          solution: spec.description,
          outcome: (outcome.failure ?? 'failed verification').slice(0, 300),
        },
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
