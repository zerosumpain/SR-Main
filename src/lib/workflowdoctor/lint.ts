// src/lib/workflowdoctor/lint.ts
//
// LINT phase — run the existing `verifyWorkflow()` over a PERSISTED graph.
//
// The linter itself is already proven; this is the same block the `workflow_lint`
// site tool runs (src/lib/workflows/site-tools/tools/workflows.ts), with the
// inputs adapted from DB rows instead of a draft object. It stays a thin adapter
// on purpose: every rule the doctor learns should land in verify.ts, where the
// canvas and the orchestrator get it too.
//
// No test file. Everything here is either already covered by verify.ts's own
// tests or is registry plumbing, and exercising it would mean standing up a fake
// NodeRegistry — a mock large enough that it would only ever test itself.

import type { VerificationIssue } from '$lib/workflows/orchestrator/verify';
import { errMsg } from './types';

export interface WorkflowLint {
  issues: VerificationIssue[];
  errorCount: number;
  warningCount: number;
  /** Same issues, grouped so a finding can attach only its own node's lint. */
  byNodeId: Record<string, VerificationIssue[]>;
}

/** Empty result — used for a graph with no nodes, and by callers on failure. */
export function emptyLint(): WorkflowLint {
  return { issues: [], errorCount: 0, warningCount: 0, byNodeId: {} };
}

function summarise(issues: VerificationIssue[]): WorkflowLint {
  const byNodeId: Record<string, VerificationIssue[]> = {};
  for (const issue of issues) {
    (byNodeId[issue.nodeId] ??= []).push(issue);
  }
  return {
    issues,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
    byNodeId,
  };
}

/**
 * Lint one persisted workflow.
 *
 * Throws only if the workflow row is gone — a caller asking about a workflow
 * that does not exist is a bug worth surfacing, not an empty result to be
 * silently believed. `lintWorkflows()` absorbs it for the batch case.
 */
export async function lintWorkflow(workflowId: string): Promise<WorkflowLint> {
  const { loadDefinition } = await import('$lib/workflows/start-run');
  const graph = await loadDefinition(workflowId, { includeDisplayOnly: true });
  if (!graph) throw new Error(`Workflow not found: ${workflowId}`);
  if (graph.nodes.length === 0) return emptyLint();
  const { nodes: nodeDefs, edges: edgeDefs } = graph;

  // SR-Workflows lints: it holds the registry the graph will actually run
  // against, dynamic nodes included. `deadTypes` adds the one check
  // verifyWorkflow skips — a node whose type no longer exists, which every run
  // fails on — as the engine's own runtime error, so the signature the doctor
  // sees at lint time is the one it sees in `workflow_runs.error` (the
  // `icloud-cal` → `apple-calendar` rename failed 5,053 runs).
  //
  // No workflow-level `trigger`: that only enables the graph-level dedupe rule,
  // which fires on workflows that are SUCCEEDING while re-sending. The doctor
  // triages failures, and a constant extra error would muddy the before/after
  // error delta the fix phase measures.
  const { invokeWorkflowRuntime } = await import('$lib/workflows/runtime-client');
  const issues = await invokeWorkflowRuntime<VerificationIssue[]>({
    action: 'lint',
    nodes: nodeDefs,
    edges: edgeDefs,
    deadTypes: true,
  });
  return summarise(issues);
}

/**
 * Lint a batch. One poison graph must not abort the phase — a workflow that
 * throws is logged and omitted from the map, and the caller treats a missing
 * entry as "no lint evidence" rather than "clean".
 */
export async function lintWorkflows(workflowIds: string[]): Promise<Map<string, WorkflowLint>> {
  const out = new Map<string, WorkflowLint>();
  for (const id of [...new Set(workflowIds)]) {
    try {
      out.set(id, await lintWorkflow(id));
    } catch (err) {
      console.error(`[workflowdoctor] lint failed for ${id}:`, errMsg(err));
    }
  }
  return out;
}
