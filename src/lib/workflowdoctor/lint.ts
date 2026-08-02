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

import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
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
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, workflowId));
  if (nodes.length === 0) return emptyLint();
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId));

  // Lazy, and it must stay lazy: `$lib/workflows` eagerly registers ~130 server
  // node modules, so a static import here would drag all of them into the
  // doctor's module graph and into every test that touches it.
  const { registry } = await import('$lib/workflows');
  const { verifyWorkflow } = await import('$lib/workflows/orchestrator/verify');

  const nodeDefs = nodes.map((n) => ({
    id: n.id,
    type: n.type,
    label: n.label,
    position: n.position as { x: number; y: number },
    config: (n.config || {}) as Record<string, unknown>,
  }));
  const edgeDefs = edges.map((e) => ({
    id: e.id,
    sourceNodeId: e.sourceNodeId,
    targetNodeId: e.targetNodeId,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
  }));

  // The dominant real failure: a node whose type was renamed out from under the
  // stored row (`icloud-cal` → `apple-calendar`, 5,053 failed runs). verifyWorkflow
  // is silent on it — `getDefinition` returns undefined and every rule guards with
  // `def?.`, so the graph that can NEVER run lints clean. Synthesise the engine's
  // own runtime error instead, so the signature the doctor sees at lint time is
  // the signature it sees in `workflow_runs.error`.
  const deadTypes: VerificationIssue[] = [];
  for (const node of nodeDefs) {
    if (registry.getDefinition(node.type) && registry.getExecutor(node.type)) continue;
    deadTypes.push({
      nodeId: node.id,
      nodeLabel: node.label,
      field: 'type',
      issue:
        `No executor found for node type: ${node.type}. This node type is not in the registry, so every ` +
        `run of this workflow fails at this node. Either the type was renamed and the stored row was not ` +
        `migrated, or the node was removed from the codebase — repoint the node at its successor type, or ` +
        `delete it from the canvas.`,
      severity: 'error',
    });
  }

  const getOutputSchema = (type: string, config: Record<string, unknown>) => {
    const executor = registry.getExecutor(type);
    if (!executor) return { type: 'object' as const };
    try {
      return executor.getOutputSchema(config);
    } catch {
      // A schema getter that throws on a malformed stored config is itself a
      // symptom, but it must not take the whole lint down with it.
      return { type: 'object' as const };
    }
  };

  // Deliberately not passing the workflow-level `trigger`: that only enables the
  // graph-level dedupe rule, which fires on workflows that are SUCCEEDING while
  // re-sending. The doctor triages failures, and a constant extra error would
  // muddy the before/after error delta the fix phase measures.
  const issues = verifyWorkflow(
    nodeDefs,
    edgeDefs,
    (type) => registry.getDefinition(type),
    getOutputSchema,
  );

  return summarise([...deadTypes, ...issues]);
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
