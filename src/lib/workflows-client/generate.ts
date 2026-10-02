import { invokeWorkflowRuntime } from './runtime-client';
import type { GeneratedWorkflow, ChatMessage, OrchestratorThinking } from './generate-types';

/**
 * Generate a workflow from a description. SR-Workflows' generator does the
 * work (grounding, planning, critique, verification); Main only asks. Progress
 * streams through `onChunk`. The caller decides what to persist.
 */
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
