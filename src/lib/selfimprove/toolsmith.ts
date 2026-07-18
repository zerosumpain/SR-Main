// src/lib/selfimprove/toolsmith.ts
//
// BUILD phase. Picks the single highest-value opportunity and authors ONE
// runtime custom tool via the same machinery `create_tool` uses (buildHandler +
// register + a custom_tools row) — then SANDBOX TEST-INVOKES it with sample
// args under a 10s timeout. A tool is only persisted if the test passes;
// otherwise the in-memory registration is rolled back and it is logged as
// rejected. Bigger ideas become written proposals (never unattended repo code).

import { db } from '$lib/db';
import { customTools } from '$lib/db/schema';
import { errMsg, type QuestionInsights, type RunAction } from './types';
import type { Budget } from './run';
import type { GatheredSignals } from './analyze';

const TEST_TIMEOUT_MS = 10_000;

interface ToolSpec {
  name: string;
  description: string;
  toolset: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  handler_code: string;
  sample_args: Record<string, unknown>;
}

interface ToolsmithPlan {
  tool: ToolSpec | null;
  proposals: string[];
}

const NAME_RE = /^[a-z][a-z0-9_]{2,60}$/;

function buildMessages(
  insights: QuestionInsights | undefined,
  signals: GatheredSignals | undefined,
): Array<{ role: 'system' | 'user'; content: string }> {
  const system =
    'You are a tool-smith for a personal AI assistant ("jkai"). Given the owner\'s question intents and unmet needs, ' +
    'design AT MOST ONE small, genuinely useful runtime tool that would help answer recurring questions, plus up to two ' +
    'bigger IDEAS (as short proposal strings). The tool\'s handler_code is an async JavaScript function BODY with `args`, ' +
    '`fetch`, and `platform` in scope; it MUST return { success: boolean, data?: any, error?: string }. RULES for handler_code: ' +
    'only call PUBLIC no-auth HTTP APIs via fetch, OR compose existing tools via `platform.call(toolName, args)`; NEVER read ' +
    'files, env vars, or secrets; keep it self-contained and fast. Provide sample_args that make the tool succeed for a smoke test. ' +
    'Respond with ONLY JSON: {"tool": {"name": snake_case string, "description": string, "toolset": string, ' +
    '"parameters": {"type":"object","properties":{...},"required":[...]}, "handler_code": string, "sample_args": object} | null, ' +
    '"proposals": string[]}. If nothing is worth building, set tool to null. No prose outside the JSON.';

  const payload = {
    intents: (insights?.intents ?? []).slice(0, 10),
    topUnmet: insights?.topUnmet ?? [],
    existingCustomTools: (signals?.customTools ?? []).map((t) => t.name),
  };
  const user = `Opportunities:\n\n${JSON.stringify(payload, null, 2)}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function coercePlan(json: unknown): ToolsmithPlan {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const proposals = Array.isArray(o.proposals) ? o.proposals.slice(0, 2).map(String) : [];
  const t = o.tool;
  if (!t || typeof t !== 'object') return { tool: null, proposals };
  const to = t as Record<string, unknown>;
  const name = typeof to.name === 'string' ? to.name.trim() : '';
  const handler_code = typeof to.handler_code === 'string' ? to.handler_code : '';
  const params = to.parameters && typeof to.parameters === 'object' ? (to.parameters as ToolSpec['parameters']) : null;
  if (!NAME_RE.test(name) || !handler_code || !params) return { tool: null, proposals };
  return {
    tool: {
      name,
      description: typeof to.description === 'string' ? to.description : name,
      toolset: typeof to.toolset === 'string' && to.toolset ? to.toolset : 'self-improve',
      parameters: { type: 'object', properties: params.properties ?? {}, required: params.required },
      handler_code,
      sample_args: (to.sample_args && typeof to.sample_args === 'object' ? to.sample_args : {}) as Record<string, unknown>,
    },
    proposals,
  };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`test invocation timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/** BUILD: author + sandbox-test one custom tool; emit proposals for bigger ideas. */
export async function buildTool(
  insights: QuestionInsights | undefined,
  signals: GatheredSignals | undefined,
  budget: Budget,
): Promise<RunAction[]> {
  const actions: RunAction[] = [];

  const { json } = await budget.call(buildMessages(insights, signals), { maxTokens: 3000, temperature: 0.4 });
  const plan = coercePlan(json);

  for (const p of plan.proposals) actions.push({ kind: 'proposal', detail: p });

  const spec = plan.tool;
  if (!spec) return actions;

  const { register, unregister, isRegisteredTool } = await import(
    '$lib/workflows/site-tools/registry-internal'
  );
  const { buildHandler } = await import('$lib/workflows/site-tools/custom-tool-loader');
  const { executeTool } = await import('$lib/workflows/site-tools/registry');

  if (isRegisteredTool(spec.name)) {
    actions.push({ kind: 'proposal', detail: `Tool "${spec.name}" already exists — skipped rebuild` });
    return actions;
  }

  // Register in-memory first so we can test-invoke it, then decide to keep.
  let registered = false;
  try {
    const handler = buildHandler(spec.name, spec.handler_code);
    register({
      name: spec.name,
      description: spec.description,
      toolset: spec.toolset,
      parameters: spec.parameters,
      category: 'Custom Tool',
      handler,
    });
    registered = true;

    const result = await withTimeout(executeTool(spec.name, spec.sample_args), TEST_TIMEOUT_MS);
    if (result.success) {
      // Keep it: persist with a self-improvement provenance tag.
      await db.insert(customTools).values({
        name: spec.name,
        description: spec.description,
        toolset: spec.toolset,
        parameters: spec.parameters,
        handlerCode: spec.handler_code,
        createdBy: 'self-improvement',
      });
      actions.push({ kind: 'tool_created', detail: `${spec.name}: ${spec.description}` });
    } else {
      unregister(spec.name);
      actions.push({
        kind: 'tool_rejected',
        detail: `${spec.name}: smoke test failed — ${result.error ?? 'no data'}`,
      });
    }
  } catch (err) {
    if (registered) unregister(spec.name);
    actions.push({ kind: 'tool_rejected', detail: `${spec.name}: ${errMsg(err).slice(0, 200)}` });
  }

  return actions;
}
