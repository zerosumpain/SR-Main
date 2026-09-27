import { invokeWorkflowTool } from './site-tools/workflow-service';
import type { EngineResult } from './engine';

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
