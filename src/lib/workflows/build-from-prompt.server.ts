import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { workflows } from '$lib/db/schema';
import { allocateCanvasName, createCanvas } from '$lib/canvas/adapter.server';
import { credentialFields } from '$lib/canvas/mutate.server';
import { AMEND_OPS_DESCRIPTION } from '$lib/canvas/amend-validate.server';
import type { AmendOp } from '$lib/canvas/amend.server';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { resilientChatCompletion } from '$lib/llm/workflow-gateway';
import { publishWorkflowUpdate } from '$lib/jkai/workflow-updates-bus';
import { recordBuildState } from './build-state.server';
import { saveWorkflowTrigger } from './trigger-save.server';
import { loadGraph } from './native/workflows.server';
import { screenNativeOps } from './native/amend.server';

/**
 * Describe-it: a workflow from a sentence, and a change to one from an
 * instruction. One module so the iPhone (now) and the web's Describe-it box
 * (wave 4) cannot drift.
 *
 * Neither path calls a model of its own choosing. `buildFromPrompt` hands the
 * whole job to the orchestrator's `generateWorkflow` — the generator
 * `workflow_generate` runs, with its grounding, critic round and escalation —
 * which resolves its model itself. `proposeAmendOps` makes ONE call through the
 * workflow gateway at the model that generator uses (`resolveDefaultModel`),
 * so a change and a build are judged by the same model.
 */

// ———————————————————————————————————————————— build

export interface BuildRequest {
  prompt: string;
  /** Shown as the canvas title. Absent → the generator's name for it. */
  title?: string | null;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Create the canvas NOW, build it in the background.
 *
 * The canvas exists before the model has said a word so the caller gets a slug
 * to open and poll; `building` reads true from the marker written here until
 * the background job writes `done` or `failed` (see `build-state.server`).
 */
export async function startBuildFromPrompt(req: BuildRequest): Promise<{ workflowId: string; slug: string }> {
  const prompt = req.prompt.trim();
  const givenTitle = req.title?.trim() || null;
  const { slug } = await allocateCanvasName(givenTitle || clip(prompt, 40));
  const { workflowId } = await createCanvas(slug, givenTitle || clip(prompt, 80));
  await recordBuildState(workflowId, 'building', `Building this workflow from your description: “${clip(prompt, 300)}”`);

  void buildInBackground(workflowId, prompt, givenTitle).catch((err) => {
    console.error(`[build-from-prompt] ${workflowId} failed outside its own handler`, err);
  });
  return { workflowId, slug };
}

async function fail(workflowId: string, error: string): Promise<void> {
  await recordBuildState(workflowId, 'failed', `The build did not finish: ${error}`, error);
  publishWorkflowUpdate({ workflowId, kind: 'build_complete', summary: 'Build failed', ts: Date.now() });
}

/** The generator's trigger → the trigger-save body, so a cron is born scheduled. */
function triggerBody(trigger: { type: string; config?: Record<string, unknown> } | undefined) {
  const cfg = trigger?.config ?? {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  switch (trigger?.type) {
    case 'cron': {
      const cron = str(cfg.expression) ?? str(cfg.cron);
      return cron ? { kind: 'cron', cron, timezone: str(cfg.timezone), enabled: true } : null;
    }
    case 'event': {
      const eventType = str(cfg.eventType);
      return eventType
        ? { kind: 'event', eventType, sourceWorkflowId: str(cfg.sourceWorkflowId), filter: cfg.filter, enabled: true }
        : null;
    }
    case 'webhook':
      return { kind: 'webhook', secret: str(cfg.secret), enabled: true };
    default:
      return null;
  }
}

export async function buildInBackground(workflowId: string, prompt: string, givenTitle: string | null): Promise<void> {
  try {
    const { generateWorkflow, saveWorkflowFromGenerated, runWorkflowVerification } = await import(
      '$lib/workflows/orchestrator'
    );

    // `null`, as workflow_generate passes when it CREATES a canvas: the
    // generator then reads no chat history (this canvas has only the marker
    // above) and writes no chat rows of its own — the markers are the record.
    const result = await generateWorkflow(prompt, null);
    if (result.followUp) {
      return fail(workflowId, `jkai needs more to go on — ${clip(result.followUp, 400)}`);
    }
    const generated = result.workflow;
    if (!generated || generated.nodes.length === 0) {
      return fail(
        workflowId,
        'no workflow came out of that description. Say what should start it, what it should do and what it should produce.',
      );
    }

    // Same guard workflow_generate applies before persisting: a prompt that
    // quotes a key hands the generator a live secret to copy into a config.
    const offenders = [
      ...new Set(generated.nodes.flatMap((n) => credentialFields((n.config ?? {}) as Record<string, unknown>))),
    ];
    if (offenders.length > 0) {
      return fail(
        workflowId,
        `a step would have held what looks like a password or API key (${offenders.join(', ')}). Store it as a credential and describe it again.`,
      );
    }

    const [row] = await db.select({ name: workflows.name }).from(workflows).where(eq(workflows.id, workflowId));
    if (!row) return; // Deleted while it was being built — nothing to write to.

    // `saveWorkflowFromGenerated` writes the generator's `name` onto the row;
    // this canvas's name is its address (`canvas:<slug>`), so keep it.
    await saveWorkflowFromGenerated(workflowId, {
      ...generated,
      name: row.name,
      description: givenTitle || generated.description || generated.name || undefined,
    });

    // A cron trigger is not a schedule: the row must exist or it never fires.
    const body = triggerBody(generated.trigger);
    if (body) {
      const saved = await saveWorkflowTrigger(workflowId, body);
      if (!saved.ok) console.warn(`[build-from-prompt] ${workflowId} trigger not saved: ${saved.error}`);
    }

    // Lint the graph as saved — the same sweep workflow_generate ends with.
    const issues = runWorkflowVerification(generated.nodes, generated.edges, generated.trigger);
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      const first = errors[0];
      return fail(
        workflowId,
        `built, but ${errors.length} step${errors.length === 1 ? '' : 's'} need fixing — ` +
          `“${first.nodeLabel}”: ${first.issue}`,
      );
    }

    await recordBuildState(workflowId, 'done', generated.explanation || 'Built from your description.');
    publishWorkflowUpdate({ workflowId, kind: 'build_complete', summary: 'Generated', ts: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[build-from-prompt] ${workflowId}`, err);
    await fail(workflowId, clip(message, 300)).catch(() => {});
  }
}

// ———————————————————————————————————————————— ask

export interface AmendProposal {
  summary: string;
  ops: AmendOp[];
  warnings: string[];
}

function askSystemPrompt(grounding: string): string {
  return `You change an existing automation workflow by proposing EDITS to its graph. You do not apply them — the owner reviews your proposal and applies it.

Answer with ONE JSON object and nothing else:
{"summary": "<one or two plain sentences saying what will change, for the owner>", "ops": [ ... ]}

## Ops

${AMEND_OPS_DESCRIPTION}

## Rules

- Use node ids EXACTLY as they appear in the current workflow. A node you add in this proposal gets a \`ref\`, and later ops point at it as "#<ref>".
- Change as little as possible. Prefer update_node over removing and re-adding a node — removing loses its run history.
- To put a step between two connected steps use insert_between; to add a step after the last one use add_node then add_edge.
- update_node config is MERGED into the existing config: send only the keys you change. null deletes a key.
- Use only node types from the Node Registry below, with their exact config keys.
- Never set allowDestructive to true, and never put a password, token or API key in any config.
- If the instruction cannot be done with these ops, return "ops": [] and say why in the summary.

## Node Registry

${grounding}`;
}

function parseProposal(raw: string): { summary: string; ops: AmendOp[] } | null {
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { summary?: unknown; ops?: unknown };
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
      ops: Array.isArray(parsed.ops) ? (parsed.ops as AmendOp[]) : [],
    };
  } catch {
    return null;
  }
}

/**
 * Ids a proposal may name: the graph's own, or a `#ref` it declares. Checked
 * here because the executor only finds out mid-transaction, and a proposal
 * the phone cannot apply is worse than none.
 */
function unknownIds(ops: AmendOp[], nodeIds: Set<string>, edgeIds: Set<string>): string[] {
  const refs = new Set(
    ops.flatMap((op) => ((op.op === 'add_node' || op.op === 'insert_between') && op.ref ? [op.ref] : [])),
  );
  const bad: string[] = [];
  const check = (id: unknown) => {
    if (typeof id !== 'string') return;
    if (id.startsWith('#') ? !refs.has(id.slice(1)) : !nodeIds.has(id)) bad.push(id);
  };
  for (const op of ops) {
    if (op.op === 'update_node' || op.op === 'remove_node') check(op.nodeId);
    if (op.op === 'add_edge' || op.op === 'insert_between') {
      check(op.sourceNodeId);
      check(op.targetNodeId);
    }
    if (op.op === 'remove_edge' && !edgeIds.has(op.edgeId)) bad.push(op.edgeId);
  }
  return bad;
}

async function screenProposal(
  ops: AmendOp[],
  nodeIds: Set<string>,
  edgeIds: Set<string>,
): Promise<string | null> {
  if (ops.length === 0) return null;
  const bad = unknownIds(ops, nodeIds, edgeIds);
  if (bad.length > 0) return `These ids are not in the workflow: ${bad.join(', ')}.`;
  const refused = await screenNativeOps(ops);
  return refused?.error ?? null;
}

/**
 * Ask the model how to make a change, and return its ops UNAPPLIED.
 *
 * Nothing here writes: no amend, no chat row, no audit entry. The ops are
 * screened by exactly what `/amend` will apply to them (plus an id check), and
 * a proposal that fails gets one repair turn with the failure quoted back. One
 * that still fails comes back empty with the reason as a warning — never as
 * ops the phone would only have refused on apply.
 */
export async function proposeAmendOps(workflowId: string, instruction: string): Promise<AmendProposal> {
  const { nodes, edges } = await loadGraph(workflowId);
  const [{ registry }, { buildNodeGrounding, buildSiteToolCatalog }] = await Promise.all([
    import('$lib/workflows'),
    import('$lib/workflows/orchestrator/grounding'),
  ]);
  const catalog = await buildSiteToolCatalog().catch(() => '');
  const nodeDocs = buildNodeGrounding(registry.listDefinitions(), []);
  const grounding = catalog ? `${nodeDocs}\n\n${catalog}` : nodeDocs;

  const current = JSON.stringify(
    {
      nodes: nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, config: n.config })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
      })),
    },
    null,
    2,
  );

  const model = (await resolveDefaultModel()).modelId;
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: askSystemPrompt(grounding) },
    { role: 'user', content: `## Current workflow\n\n\`\`\`json\n${current}\n\`\`\`\n\n## Instruction\n\n${instruction}` },
  ];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edgeIds = new Set(edges.map((e) => e.id));

  let lastProblem = 'The model did not answer with a proposal.';
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await resilientChatCompletion(model, {
      messages,
      temperature: 0.2,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    });
    const raw = response.choices[0]?.message?.content ?? '';
    const proposal = parseProposal(typeof raw === 'string' ? raw : '');
    if (!proposal) {
      lastProblem = 'The model did not answer with a proposal.';
    } else {
      const problem = await screenProposal(proposal.ops, nodeIds, edgeIds);
      if (!problem) {
        return {
          summary: proposal.summary || (proposal.ops.length === 0 ? 'No change proposed.' : 'Proposed changes.'),
          ops: proposal.ops,
          warnings: [],
        };
      }
      lastProblem = problem;
    }
    messages.push(
      { role: 'assistant', content: typeof raw === 'string' ? raw : '' },
      {
        role: 'user',
        content: `That proposal cannot be applied: ${lastProblem}\nReturn the corrected JSON object — the whole ops list, not just the fix.`,
      },
    );
  }

  return {
    summary: 'jkai could not work out a change it could apply.',
    ops: [],
    warnings: [lastProblem],
  };
}
