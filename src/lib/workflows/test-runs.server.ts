import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { workflows, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { DatastoreError, deleteRecord, ensureCollection, getCollectionBySlug, getRecordByKey, queryRecords, upsertRecord } from '$lib/datastore';
import { eventEntry } from '$lib/events/catalogue';
import type { PinnedOutput } from './side-effects';
import { loadDefinition, startRun, type StartedRun } from './start-run';
import type { WorkflowDefinition } from './types';

/**
 * Test runs: cheap for a person to start, and mandatory for the model.
 *
 * A test run (`workflow_runs.mode = 'test'`) swaps every PINNED node for its
 * saved output, stubs every side-effecting node (engine, `side-effects.ts`) and
 * announces nothing. "Run from here" is a test run whose upstream nodes are
 * pinned, for that run only, to what they last produced.
 *
 * Pins live in a datastore collection, not in node config: a 64 KB output in
 * config would ride along in every `workflow_versions` snapshot, move the
 * definition hash of LIVE runs, and be pasted into every prompt that quotes the
 * graph (the generator, the Ask bar, chat's inspect). Same precedent as
 * `workflow_fix_proposals` — no schema change, keyed upserts.
 */

export const PINS_COLLECTION = 'workflow_node_pins';
/** A pin bigger than this is refused: it is test data, not an archive. */
export const PIN_MAX_BYTES = 64 * 1024;
/** How long the model's proof run may take before it is cancelled. */
export const PROOF_TIMEOUT_MS = 90_000;
const ACTOR = 'system';

export interface NodePin extends PinnedOutput {
  workflowId: string;
  nodeId: string;
  sourceRunId: string | null;
  pinnedAt: string;
  bytes: number;
}

export class TestRunError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'TestRunError';
  }
}

const OWNER_ONLY = { read: ['owner', 'system'], write: ['owner', 'system'], delete: ['owner', 'system'] };
const pinKey = (workflowId: string, nodeId: string) => `${workflowId}:${nodeId}`;

/** A workflow's pins by node id. */
export async function listPins(workflowId: string): Promise<Record<string, NodePin>> {
  if (!(await getCollectionBySlug(PINS_COLLECTION))) return {};
  const filters = [{ path: 'workflowId', op: 'eq' as const, value: workflowId }];
  const { records } = await queryRecords(PINS_COLLECTION, { filters, limit: 500 }, ACTOR);
  return Object.fromEntries(records.map((r) => [(r.data as unknown as NodePin).nodeId, r.data as unknown as NodePin]));
}

export async function setPin(
  workflowId: string,
  nodeId: string,
  pin: { output: unknown; handle?: string | null; sourceRunId?: string | null },
): Promise<NodePin> {
  if (!pin.output || typeof pin.output !== 'object' || Array.isArray(pin.output)) {
    throw new TestRunError(400, 'A pinned output must be a JSON object.');
  }
  const def = await loadDefinition(workflowId);
  if (!def) throw new TestRunError(404, 'Workflow not found');
  if (!def.nodes.some((n) => n.id === nodeId)) throw new TestRunError(404, 'No such step in this workflow');
  // The markers a test run adds are not part of what the node produced.
  const { _pinned: _p, _stubbed: _s, ...output } = pin.output as Record<string, unknown>;
  const bytes = Buffer.byteLength(JSON.stringify(output), 'utf8');
  if (bytes > PIN_MAX_BYTES) {
    throw new TestRunError(413, `That output is ${Math.round(bytes / 1024)} KB; a pin holds at most ${PIN_MAX_BYTES / 1024} KB.`);
  }
  const data: NodePin = {
    workflowId, nodeId, output, handle: pin.handle ?? null, sourceRunId: pin.sourceRunId ?? null, pinnedAt: new Date().toISOString(), bytes,
  };
  await ensureCollection(PINS_COLLECTION, {
    name: 'Workflow Node Pins',
    description: 'Saved node outputs a TEST run uses instead of running the node. Never read by a live run.',
    isSystem: true,
    defaultPermissions: OWNER_ONLY,
  }, ACTOR);
  await upsertRecord(PINS_COLLECTION, { key: pinKey(workflowId, nodeId), data: data as unknown as Record<string, unknown> }, ACTOR);
  return data;
}

/** "Pin this output": what the node produced (and the branch it took) in a past run. */
export async function pinFromRun(workflowId: string, nodeId: string, runId: string): Promise<NodePin> {
  const [row] = await db
    .select({ output: nodeExecutions.outputData, handle: nodeExecutions.selectedHandle, runWorkflow: workflowRuns.workflowId })
    .from(nodeExecutions)
    .innerJoin(workflowRuns, eq(workflowRuns.id, nodeExecutions.runId))
    .where(and(eq(nodeExecutions.runId, runId), eq(nodeExecutions.nodeId, nodeId)))
    .limit(1);
  if (!row || row.runWorkflow !== workflowId) throw new TestRunError(404, 'That step did not run in that run');
  if (!row.output) throw new TestRunError(400, 'That step produced no output in that run');
  return setPin(workflowId, nodeId, { output: row.output, handle: row.handle, sourceRunId: runId });
}

export async function removePin(workflowId: string, nodeId: string): Promise<boolean> {
  if (!(await getCollectionBySlug(PINS_COLLECTION))) return false;
  try {
    await getRecordByKey(PINS_COLLECTION, pinKey(workflowId, nodeId), ACTOR);
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') return false;
    throw err;
  }
  await deleteRecord(PINS_COLLECTION, { key: pinKey(workflowId, nodeId) }, ACTOR);
  return true;
}

/**
 * What a test run is fed when nobody says: the last LIVE run's input, else the
 * event catalogue's example for an event trigger (shaped as the event bus
 * delivers it), else nothing.
 */
export async function samplePayload(workflowId: string): Promise<Record<string, unknown>> {
  const [last] = await db
    .select({ input: workflowRuns.inputData })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.mode, 'live'), isNotNull(workflowRuns.inputData)))
    .orderBy(sql`${workflowRuns.startedAt} DESC NULLS LAST`)
    .limit(1);
  const input = last?.input;
  if (input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length > 0) {
    return input as Record<string, unknown>;
  }
  const [wf] = await db.select({ trigger: workflows.trigger }).from(workflows).where(eq(workflows.id, workflowId)).limit(1);
  const trigger = wf?.trigger as { type?: string; eventType?: string } | null;
  const entry = trigger?.type === 'event' && trigger.eventType ? eventEntry(trigger.eventType) : null;
  return entry ? { event: entry.payloadExample, eventType: entry.type, eventId: null } : {};
}

/** The node and everything reachable from it. */
export function downstreamOf(def: WorkflowDefinition, fromNodeId: string): Set<string> {
  const out = new Set([fromNodeId]);
  const queue = [fromNodeId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of def.edges) {
      if (e.sourceNodeId === id && !out.has(e.targetNodeId)) {
        out.add(e.targetNodeId);
        queue.push(e.targetNodeId);
      }
    }
  }
  return out;
}

/**
 * Run-from-here: every node that is NOT the chosen one or downstream of it is
 * pinned for this run to its own pin, else to its latest recorded output (and
 * branch). The chosen node always executes, pinned or not.
 */
async function seedUpstream(
  def: WorkflowDefinition,
  fromNodeId: string,
  pins: Record<string, PinnedOutput>,
): Promise<Record<string, PinnedOutput>> {
  const down = downstreamOf(def, fromNodeId);
  const upstream = def.nodes.map((n) => n.id).filter((id) => !down.has(id));
  const seeded: Record<string, PinnedOutput> = Object.fromEntries(
    Object.entries(pins).filter(([id]) => id !== fromNodeId),
  );
  const missing = upstream.filter((id) => !seeded[id]);
  if (missing.length > 0) {
    const latest = await db
      .selectDistinctOn([nodeExecutions.nodeId], {
        nodeId: nodeExecutions.nodeId,
        output: nodeExecutions.outputData,
        handle: nodeExecutions.selectedHandle,
      })
      .from(nodeExecutions)
      .where(and(inArray(nodeExecutions.nodeId, missing), eq(nodeExecutions.status, 'completed'), isNotNull(nodeExecutions.outputData)))
      .orderBy(nodeExecutions.nodeId, sql`${nodeExecutions.completedAt} DESC NULLS LAST`);
    for (const r of latest) {
      seeded[r.nodeId] = { output: r.output as Record<string, unknown>, handle: r.handle };
    }
  }
  return seeded;
}

export interface TestRunRequest {
  workflowId: string;
  /** The trigger payload. Absent → `samplePayload`. */
  input?: Record<string, unknown>;
  /** Side-effecting node ids that run for real this once. */
  allowSideEffects?: string[];
  /** Run from here: this node and everything downstream; the rest seeded. */
  fromNodeId?: string;
  trigger?: string;
  label?: string;
}

/** Start a test run through the run kernel. Null when the workflow is gone. */
export async function startTestRun(req: TestRunRequest): Promise<StartedRun | null> {
  const def = await loadDefinition(req.workflowId);
  if (!def) return null;
  const stored = await listPins(req.workflowId).catch(() => ({}) as Record<string, NodePin>);
  let pins: Record<string, PinnedOutput> = Object.fromEntries(
    Object.entries(stored).map(([id, p]) => [id, { output: p.output, handle: p.handle }]),
  );
  if (req.fromNodeId) {
    if (!def.nodes.some((n) => n.id === req.fromNodeId)) throw new TestRunError(404, 'No such step in this workflow');
    pins = await seedUpstream(def, req.fromNodeId, pins);
  }
  return startRun({
    workflowId: req.workflowId, definition: def, trigger: req.trigger ?? 'manual', mode: 'test', pins,
    input: req.input ?? (await samplePayload(req.workflowId)),
    allowSideEffects: req.allowSideEffects, watchdog: true, label: req.label ?? 'test-run',
  });
}

// ———————————————————————————————————————————— the model's proof

/**
 * The `verification` block every workflow-building tool result carries. It is
 * the CONTRACT: a tool that built or changed a workflow says, in data, whether
 * it lints and what a test run of it did — so "done" cannot be claimed on
 * prose alone.
 */
export interface WorkflowVerification {
  lint: { errors: number; warnings: number; issues: string[] };
  testRun: {
    runId: string | null;
    /** completed | completed_with_errors | failed | awaiting_human | timed_out | skipped */
    status: string;
    failedNode?: string;
    error?: string;
    /** Labels of the side-effecting steps that were stubbed, not run. */
    stubbed: string[];
    pinned: string[];
  };
  passed: boolean;
  /** Present when one automatic repair round ran. */
  repair?: { applied: boolean; summary: string; before: string };
}

/** A run that stopped at an approval did everything a test run can do. */
const PASSING = new Set(['completed', 'awaiting_human']);

/** One plain sentence for a failed verification — what the chat and the build banner say. */
export function describeVerification(v: WorkflowVerification): string {
  if (v.lint.errors > 0) return `lint found ${v.lint.errors} error(s): ${v.lint.issues.slice(0, 3).join('; ')}`;
  const t = v.testRun;
  if (t.status === 'completed') return `the test run completed${t.stubbed.length ? ` (stubbed: ${t.stubbed.join(', ')})` : ''}`;
  if (t.status === 'awaiting_human') return `the test run reached "${t.failedNode ?? 'an approval'}" and stopped there to wait for a person`;
  const where = t.failedNode ? ` at "${t.failedNode}"` : '';
  return `the test run ${t.status === 'timed_out' ? 'timed out' : 'failed'}${where}${t.error ? `: ${t.error}` : ''}`;
}

async function waitFor(done: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    done.then(() => true),
    new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms); }),
  ]);
  clearTimeout(timer);
  return settled;
}

/**
 * Lint the saved graph, then — if it lints clean — run it in TEST mode with a
 * sample payload and read back what happened. Never throws for a workflow that
 * is wrong; that is what the result is for.
 */
export async function proveWorkflow(
  workflowId: string,
  opts: { fromNodeId?: string; input?: Record<string, unknown>; timeoutMs?: number } = {},
): Promise<WorkflowVerification> {
  const graph = await loadDefinition(workflowId);
  if (!graph) throw new TestRunError(404, 'Workflow not found');
  const { runWorkflowVerification } = await import('./orchestrator');
  // The canvas's chat panel is not a step (the engine skips it unwired), and its
  // panel settings read to the linter as unknown keys on every canvas.
  const steps = graph.nodes.filter((n) => n.type !== 'chat');
  const ids = new Set(steps.map((n) => n.id));
  const issues = runWorkflowVerification(steps, graph.edges.filter((e) => ids.has(e.sourceNodeId) && ids.has(e.targetNodeId)));
  const errors = issues.filter((i) => i.severity === 'error');
  const lint = {
    errors: errors.length,
    warnings: issues.length - errors.length,
    issues: errors.slice(0, 5).map((i) => `"${i.nodeLabel}" ${i.field}: ${i.issue}`),
  };
  const none = { stubbed: [] as string[], pinned: [] as string[] };
  if (errors.length > 0) {
    return { lint, passed: false, testRun: { runId: null, status: 'skipped', error: 'not run: fix the lint errors first', ...none } };
  }

  const started = await startTestRun({ workflowId, input: opts.input, fromNodeId: opts.fromNodeId, label: 'proof-run' });
  if (!started) throw new TestRunError(404, 'Workflow not found');
  let timedOut = false;
  if (!(await waitFor(started.done, opts.timeoutMs ?? PROOF_TIMEOUT_MS))) {
    timedOut = true;
    const { engine } = await import('$lib/workflows');
    engine.cancelRun(started.runId);
    await waitFor(started.done, 10_000);
  }

  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, started.runId)).limit(1);
  const execs = await db.select().from(nodeExecutions).where(eq(nodeExecutions.runId, started.runId));
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const marked = (key: '_stubbed' | '_pinned') =>
    execs.filter((e) => (e.outputData as Record<string, unknown> | null)?.[key] === true).map((e) => label(e.nodeId));
  const failed = execs
    .filter((e) => e.status === 'failed')
    .sort((a, b) => (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0))[0];
  const status = timedOut ? 'timed_out' : run?.status ?? 'failed';
  const failedNodeId = status === 'awaiting_human' ? run?.pausedAtNodeId ?? undefined : failed?.nodeId;
  return {
    lint,
    passed: PASSING.has(status),
    testRun: {
      runId: started.runId,
      status,
      ...(failedNodeId ? { failedNode: label(failedNodeId) } : {}),
      ...(status !== 'completed' && status !== 'awaiting_human'
        ? { error: (failed?.error ?? run?.error ?? (timedOut ? `no result within ${Math.round((opts.timeoutMs ?? PROOF_TIMEOUT_MS) / 1000)}s` : '')).slice(0, 400) }
        : {}),
      stubbed: marked('_stubbed'),
      pinned: marked('_pinned'),
    },
  };
}

/**
 * `proveWorkflow`, plus ONE automatic repair round when it fails: the failure
 * goes to the Ask path (`proposeAmendOps`), the proposal is applied through
 * `applyAmendOps` (versioned, audited), and the workflow is proved once more.
 * Never loops — whatever the second proof says is the answer.
 */
export async function proveWithRepair(
  workflowId: string,
  opts: { fromNodeId?: string; input?: Record<string, unknown>; timeoutMs?: number } = {},
): Promise<WorkflowVerification> {
  const first = await proveWorkflow(workflowId, opts);
  if (first.passed) return first;
  const before = describeVerification(first);
  try {
    const { proposeAmendOps } = await import('./build-from-prompt.server');
    const proposal = await proposeAmendOps(
      workflowId,
      `This workflow was just built and ${before}. Fix the cause with the smallest change. ` +
        'Never swap a URL, address, recipient or other value the owner gave for a different one, and never remove a step, ' +
        'to make the failure go away. If the cause is outside the workflow (an address that does not answer, a missing ' +
        'credential), propose no ops and say so in the summary.',
    );
    if (proposal.ops.length === 0) {
      return { ...first, repair: { applied: false, summary: proposal.warnings[0] ?? proposal.summary, before } };
    }
    const { applyAmendOps } = await import('$lib/canvas/amend.server');
    await applyAmendOps({ workflowId, ops: proposal.ops, actor: 'system', reason: `test-run repair: ${before}`.slice(0, 300) });
    const second = await proveWorkflow(workflowId, opts);
    return { ...second, repair: { applied: true, summary: proposal.summary, before } };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { ...first, repair: { applied: false, summary: `repair failed: ${why.slice(0, 200)}`, before } };
  }
}
