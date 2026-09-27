import { invokeWorkflowRuntime } from '../runtime-client';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { GeneratedWorkflow, ChatMessage, OrchestratorThinking } from './types';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '../types';
import type { VerificationIssue } from './verify';
export { getChatHistory } from '$lib/workflows/chat/history';

/** Verify against the same node registry that will execute the generated graph. */
export async function runWorkflowVerification(nodes: WorkflowNodeDef[], edges: WorkflowEdgeDef[], trigger?: { type: string; config?: Record<string, unknown> }): Promise<VerificationIssue[]> {
  return invokeWorkflowRuntime({ action: 'lint', nodes, edges, trigger });
}

export async function generateWorkflow(
  userMessage: string,
  workflowId: string | null,
  onChunk?: (text: string) => void,
  opts?: { skipVerification?: boolean },
): Promise<{
  workflow: GeneratedWorkflow | null;
  followUp?: string;
  thinking?: OrchestratorThinking;
  messages: ChatMessage[];
}> {
  return invokeWorkflowRuntime({ action: 'generate', userMessage, workflowId, options: opts }, onChunk);
}

export async function modifyWorkflow(
  userMessage: string,
  workflowId: string,
  currentNodes: WorkflowNodeDef[],
  currentEdges: WorkflowEdgeDef[],
  onChunk?: (text: string) => void,
): Promise<{
  workflow: GeneratedWorkflow | null;
  followUp?: string;
  thinking?: OrchestratorThinking;
}> {
  return invokeWorkflowRuntime({ action: 'modify', userMessage, workflowId, currentNodes, currentEdges }, onChunk);
}

export async function saveWorkflowFromGenerated(
  workflowId: string,
  generated: GeneratedWorkflow,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(workflowNodes).where(eq(workflowNodes.workflowId, workflowId));
    await tx.delete(workflowEdges).where(eq(workflowEdges.workflowId, workflowId));

    await tx.update(workflows).set({
      name: generated.name,
      description: generated.description || null,
      trigger: generated.trigger ?? { type: 'manual' },
      updatedAt: new Date(),
    }).where(eq(workflows.id, workflowId));

    if (generated.nodes.length > 0) {
      await tx.insert(workflowNodes).values(
        generated.nodes.map((n) => ({
          id: n.id,
          workflowId,
          type: n.type,
          position: n.position,
          config: n.config,
          label: n.label,
        })),
      );
    }

    if (generated.edges.length > 0) {
      await tx.insert(workflowEdges).values(
        generated.edges.map((e) => ({
          id: e.id,
          workflowId,
          sourceNodeId: e.sourceNodeId,
          targetNodeId: e.targetNodeId,
          sourceHandle: e.sourceHandle || null,
          targetHandle: e.targetHandle || null,
        })),
      );
    }
  });
}
