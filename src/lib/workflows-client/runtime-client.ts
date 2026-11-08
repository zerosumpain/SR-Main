import { invokeWorkflowTool } from '$lib/tools/workflow-service';
import type { RunStatus, UndoEntry } from './types';
import type { UsageRollup } from '$lib/context/execution';

/** A run's settled outcome as SR-Workflows reports it. */
export interface EngineResult {
  status: RunStatus;
  nodeOutputs: Map<string, Record<string, unknown>>;
  nodeInputs: Map<string, Record<string, unknown>>;
  nodeErrors: Map<string, string>;
  /** Per-node LLM cost/token rollup; nodes with no LLM calls are absent. */
  nodeUsage: Map<string, UsageRollup>;
  /** When each node began executing — wall-clock. */
  nodeStartTimes: Map<string, Date>;
  /** The handle each branching node selected. Nodes that did not branch are absent. */
  nodeSelectedHandles: Map<string, string>;
  error?: string;
  healingHistory?: UndoEntry[];
  /** Populated when the run paused mid-way for human interaction. */
  pausedAtNodeId?: string;
}

/** Trusted Main callers use the explicit destructive lane; there is no local fallback or retry. */
export async function invokeWorkflowRuntime<T>(args: Record<string, unknown>, emit?: (message: string) => void): Promise<T> {
  const result = await invokeWorkflowTool('__workflow_runtime_v1', args, true, emit ? { emit } : undefined);
  if (!result.success) throw new Error(result.error ?? 'Workflows runtime unavailable');
  return result.data as T;
}

type WireResult = Omit<EngineResult, 'nodeOutputs' | 'nodeInputs' | 'nodeErrors' | 'nodeUsage' | 'nodeStartTimes' | 'nodeSelectedHandles'> & {
  nodeOutputs: Array<[string, Record<string, unknown>]>;
  nodeInputs: Array<[string, Record<string, unknown>]>;
  nodeErrors: Array<[string, string]>;
  nodeUsage: Array<[string, EngineResult['nodeUsage'] extends Map<string, infer V> ? V : never]>;
  nodeStartTimes: Array<[string, string]>;
  nodeSelectedHandles: Array<[string, string]>;
};
export function decodeEngineResult(result: WireResult | null): EngineResult | null {
  return result && { ...result, nodeOutputs: new Map(result.nodeOutputs), nodeInputs: new Map(result.nodeInputs),
    nodeErrors: new Map(result.nodeErrors), nodeUsage: new Map(result.nodeUsage),
    nodeStartTimes: new Map(result.nodeStartTimes.map(([k, v]) => [k, new Date(v)])),
    nodeSelectedHandles: new Map(result.nodeSelectedHandles) };
}
export type RemoteStartedRun = { runId: string; status: 'pending' | 'running'; result: WireResult | null };
export async function verifyRemoteWorkflow(definition: unknown, runId: string, input: Record<string, unknown>, workflowId?: string): Promise<EngineResult> {
  const result = decodeEngineResult(await invokeWorkflowRuntime<WireResult>({ action: 'verify', definition, runId, input, workflowId }));
  if (!result) throw new Error('Workflows returned no verification result');
  return result;
}

export type ResolveInteractionReason =
  | 'not_pending'
  | 'cancelled';

export interface ResolveInteractionResult {
  resolved: boolean;
  reason?: ResolveInteractionReason;
}

/**
 * Resolve a pending workflow interaction and, if the run was paused
 * (`awaiting_human`), resume it. SR-Workflows owns resolution and resumption;
 * the inbound WhatsApp approval handler calls this adapter.
 */
export async function resolveInteraction(opts: {
  runId: string;
  nodeId: string;
  formValues: Record<string, unknown>;
  resolvedBy?: string | null;
}): Promise<ResolveInteractionResult> {
  return invokeWorkflowRuntime<ResolveInteractionResult>({ action: 'resolve', options: opts });
}
