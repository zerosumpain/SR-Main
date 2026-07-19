// Edge auto-mapping — the LLM-backed proposer. SERVER ONLY (DB + LLM gateway).
// Given a persisted A→B connection, work out how A's output should flow into B
// and return a set of user-approvable actions. Falls back to the deterministic
// heuristic on any LLM failure. Never trusts raw LLM output: only real target
// config keys are accepted.
import { db } from '$lib/db';
import { workflowNodes, workflowEdges, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { registry } from '$lib/workflows';
import type { JsonSchema, WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';
import { resolveUpstreamSchema, schemaToVariablePaths } from '$lib/workflows/schema-propagation';
import { computeUpstreamFields } from '$lib/canvas/upstream-fields';
import { resilientChatCompletion } from '$lib/llm/workflow-gateway';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { getDefinition } from '$lib/workflows/registry-client';
import type { EdgeMappingProposal, MappingContext } from './types';
import { edgeCompatibility, heuristicMapping } from './compatibility';
import { parseLooseJson, sanitizeActions } from './sanitize';

function getOutputSchema(type: string, config: Record<string, unknown>): JsonSchema {
  const executor = registry.getExecutor(type);
  if (executor) return executor.getOutputSchema(config);
  return { type: 'object' };
}

interface LoadedContext {
  source: WorkflowNodeDef;
  target: WorkflowNodeDef;
  availablePaths: string[];
  sourceOutputSample: unknown;
}

async function loadContext(
  workflowId: string,
  sourceNodeId: string,
  targetNodeId: string,
): Promise<LoadedContext | null> {
  const [nodeRows, edgeRows] = await Promise.all([
    db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, workflowId)),
    db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId)),
  ]);

  const nodes: WorkflowNodeDef[] = nodeRows.map((n) => ({
    id: n.id,
    type: n.type,
    position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
    config: (n.config as Record<string, unknown>) ?? {},
    label: n.label ?? n.type,
  }));
  const edges: WorkflowEdgeDef[] = edgeRows.map((e) => ({
    id: e.id,
    sourceNodeId: e.sourceNodeId,
    targetNodeId: e.targetNodeId,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
  }));

  const source = nodes.find((n) => n.id === sourceNodeId);
  const target = nodes.find((n) => n.id === targetNodeId);
  if (!source || !target) return null;

  // Schema-derived available paths for the target (works before any run).
  const schema = resolveUpstreamSchema(targetNodeId, nodes, edges, getOutputSchema);
  const schemaPaths = schemaToVariablePaths(schema).map((v) => v.path);

  // Real emitted paths + a sample of the source's last-run output (if any).
  let runPaths: string[] = [];
  let sourceOutputSample: unknown = undefined;
  const [latestRun] = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, workflowId))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(1);
  if (latestRun) {
    const execs = await db.select().from(nodeExecutions).where(eq(nodeExecutions.runId, latestRun.id));
    const outByNode = new Map(execs.map((x) => [x.nodeId, x.outputData]));
    sourceOutputSample = outByNode.get(sourceNodeId);
    const nodesWithOutput = nodes.map((n) => ({ id: n.id, outputData: outByNode.get(n.id) ?? undefined }));
    runPaths = computeUpstreamFields(
      targetNodeId,
      nodesWithOutput,
      edges.map((e) => ({ sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId })),
    );
  }

  const availablePaths = [...new Set([...schemaPaths, ...runPaths])];
  return { source, target, availablePaths, sourceOutputSample };
}

function truncate(value: unknown, max = 1200): string {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return s.length > max ? s.slice(0, max) + '…(truncated)' : s;
  } catch {
    return String(value);
  }
}

function buildPrompt(ctx: LoadedContext, compatSummary: string): { system: string; user: string; targetKeys: string[] } {
  const sourceDef = getDefinition(ctx.source.type);
  const targetDef = getDefinition(ctx.target.type);
  const targetProps = (targetDef?.configSchema?.properties ?? {}) as Record<string, { type?: string; description?: string }>;
  const targetKeys = Object.keys(targetProps);

  const fieldLines = targetKeys
    .map((k) => `  - ${k} (${targetProps[k].type ?? 'any'})${targetProps[k].description ? ` — ${targetProps[k].description}` : ''}`)
    .join('\n');

  const examples = (targetDef?.llmExamples ?? []).slice(0, 2);

  const system =
    'You are a workflow wiring assistant. A SOURCE node has just been connected into a TARGET node on a visual workflow canvas. ' +
    'Propose how to configure the TARGET so it consumes the SOURCE\'s output, referencing upstream data with {{input.PATH}} templates. ' +
    'Return STRICT JSON only. Rules: only use `field` names from the TARGET\'s configurable-fields list; only reference {{input.PATH}} paths from the emitted-fields list; ' +
    'prefer an idempotent write (e.g. upsert, with a stable natural key) for database targets; keep actions minimal and high-value; ' +
    'if the two nodes cannot sensibly connect, say so with compatible:"incompatible" and add a note suggesting a bridge.';

  const user = [
    `SOURCE node: ${ctx.source.type} ("${ctx.source.label}")`,
    `  what it does: ${sourceDef?.llmDescription ?? sourceDef?.description ?? '(no description)'}`,
    `  fields it emits (use these in {{input.PATH}}): ${ctx.availablePaths.length ? ctx.availablePaths.join(', ') : '(none observed yet — infer from its description)'}`,
    ctx.sourceOutputSample !== undefined ? `  sample output: ${truncate(ctx.sourceOutputSample)}` : '  sample output: (node has not run yet)',
    '',
    `TARGET node: ${ctx.target.type} ("${ctx.target.label}")`,
    `  what it does: ${targetDef?.llmDescription ?? targetDef?.description ?? '(no description)'}`,
    '  configurable fields (ONLY set these):',
    fieldLines || '  (none)',
    `  current config: ${truncate(ctx.target.config, 600)}`,
    examples.length ? `  examples of good config: ${truncate(examples, 800)}` : '',
    '',
    `Handle compatibility: ${compatSummary}`,
    '',
    'Return JSON of shape:',
    '{ "compatible": "direct"|"transform"|"incompatible", "rationale": "<=200 chars", "confidence": 0.0-1.0,',
    '  "actions": [ { "kind": "set-config", "field": "<field>", "value": <string-with-{{input.PATH}}-or-literal>, "label": "<short>", "detail": "<why>" },',
    '               { "kind": "note", "label": "<short>", "detail": "<guidance>" } ] }',
  ].join('\n');

  return { system, user, targetKeys };
}

/**
 * Propose a field mapping for a freshly-connected A→B edge. Returns actions the
 * user can apply to the TARGET node's config. Deterministic compatibility is
 * always computed; the LLM enriches the mapping and falls back to the heuristic.
 */
export async function proposeEdgeMapping(params: {
  workflowId: string;
  sourceNodeId: string;
  targetNodeId: string;
  signal?: AbortSignal;
}): Promise<EdgeMappingProposal | null> {
  const ctx = await loadContext(params.workflowId, params.sourceNodeId, params.targetNodeId);
  if (!ctx) return null;

  const compat = edgeCompatibility(ctx.source.type, ctx.target.type);
  const targetDef = getDefinition(ctx.target.type);
  const targetKeys = Object.keys((targetDef?.configSchema?.properties ?? {}) as Record<string, unknown>);

  const mappingCtx: MappingContext = {
    sourceType: ctx.source.type,
    targetType: ctx.target.type,
    sourceLabel: ctx.source.label,
    targetLabel: ctx.target.label,
    targetConfig: ctx.target.config,
    targetConfigKeys: targetKeys,
    availablePaths: ctx.availablePaths,
  };

  const base: EdgeMappingProposal = {
    sourceNodeId: params.sourceNodeId,
    targetNodeId: params.targetNodeId,
    sourceType: ctx.source.type,
    targetType: ctx.target.type,
    sourceLabel: ctx.source.label,
    targetLabel: ctx.target.label,
    compatibility: compat,
    actions: [],
    configPatch: {},
    rationale: '',
    confidence: 0,
    provenance: 'heuristic',
  };

  // Try the LLM; on any failure, fall back to the deterministic heuristic.
  try {
    const { system, user, targetKeys: keys } = buildPrompt(ctx, `${compat.level} (${compat.reasons[0] ?? ''})`);
    const model = (await resolveDefaultModel('chat')).modelId;
    const res = await resilientChatCompletion(
      model,
      {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
      },
      { signal: params.signal },
    );
    const content = res.choices[0]?.message?.content ?? '';
    const parsed = parseLooseJson(content);
    if (parsed) {
      const { actions, configPatch } = sanitizeActions(parsed.actions, keys, ctx.availablePaths);
      const conf = Number(parsed.confidence);
      // Honour the LLM verdict even when it proposes NO config change — a
      // note-only / "these don't fit" answer is bridging guidance the user
      // should see, not a reason to override it with the blunt heuristic.
      if (actions.length > 0) {
        return {
          ...base,
          actions,
          configPatch,
          rationale: typeof parsed.rationale === 'string' ? parsed.rationale : `Mapped ${ctx.source.label} → ${ctx.target.label}.`,
          confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.6,
          provenance: 'llm',
        };
      }
    }
  } catch (err) {
    console.warn('[mapping] LLM proposal failed, using heuristic:', err instanceof Error ? err.message : err);
  }

  const h = heuristicMapping(mappingCtx);
  return { ...base, actions: h.actions, configPatch: h.configPatch, rationale: h.rationale, confidence: h.confidence, provenance: 'heuristic' };
}
