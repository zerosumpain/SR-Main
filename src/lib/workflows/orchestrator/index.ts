import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import { db } from '$lib/db';
import { orchestratorChats, workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { buildPlannerPrompt, buildCriticPrompt, buildRevisionPrompt, buildModifyPrompt } from './prompts';
import { parseWorkflowResponse, extractJsonFromResponse, isFollowUpQuestion } from './parser';
import { nodeDefinitions } from '../registry-client';
import type { GeneratedWorkflow, PlanningResult, ChatMessage } from './types';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '../types';

const availableNodeTypes = nodeDefinitions.map((d) => d.type);

export async function generateWorkflow(
  userMessage: string,
  workflowId: string | null,
  onChunk?: (text: string) => void,
): Promise<{ workflow: GeneratedWorkflow | null; followUp?: string; messages: ChatMessage[] }> {
  const client = getOpenAIClient();
  const model = getModel();
  const messages: ChatMessage[] = [];

  // Load prior conversation as context
  let conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
  if (workflowId) {
    const history = await getChatHistory(workflowId);
    conversationHistory = history.map(h => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    }));
  }

  // Round 1 — Planner (with conversation history as context)
  onChunk?.('Planning workflow...\n');

  const plannerSystem = buildPlannerPrompt(availableNodeTypes);
  const plannerMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
    { role: 'system', content: plannerSystem },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  const r1 = await client.chat.completions.create({
    model,
    messages: plannerMessages,
    temperature: 0.7,
    max_tokens: 4096,
  });

  const proposal = r1.choices[0]?.message?.content ?? '';
  let tokensUsed = r1.usage?.total_tokens ?? 0;
  onChunk?.('Reviewing plan...\n');

  // Round 2 — Critic
  const criticSystem = buildCriticPrompt();
  const r2 = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: criticSystem },
      { role: 'user', content: `Review this workflow design:\n\n${proposal}` },
    ],
    temperature: 0.6,
    max_tokens: 2048,
  });

  const critique = r2.choices[0]?.message?.content ?? '';
  tokensUsed += r2.usage?.total_tokens ?? 0;

  // Round 3 — Revision (only if critic found issues)
  let finalResponse = proposal;
  if (!critique.toLowerCase().includes('no issues found')) {
    onChunk?.('Revising based on feedback...\n');

    const revisionSystem = buildRevisionPrompt();
    const r3 = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: plannerSystem },
        { role: 'user', content: userMessage },
        { role: 'assistant', content: proposal },
        { role: 'user', content: `[Critic review]\n\n${critique}` },
        { role: 'user', content: revisionSystem },
      ],
      temperature: 0.7,
      max_tokens: 4096,
    });

    finalResponse = r3.choices[0]?.message?.content ?? proposal;
    tokensUsed += r3.usage?.total_tokens ?? 0;
  }

  // Check if the LLM is asking a follow-up question instead of generating a workflow
  const rawJson = extractJsonFromResponse(finalResponse);
  if (rawJson && isFollowUpQuestion(rawJson)) {
    const question = rawJson.question + (rawJson.context ? `\n\n${rawJson.context}` : '');
    console.log('[orchestrator] LLM asking follow-up question:', question.slice(0, 200));

    if (workflowId) {
      await db.insert(orchestratorChats).values({ workflowId, role: 'user', content: userMessage });
      await db.insert(orchestratorChats).values({ workflowId, role: 'assistant', content: question });
    }

    return { workflow: null, followUp: question, messages: [] };
  }

  const workflow = parseWorkflowResponse(finalResponse);

  if (!workflow) {
    console.error('[orchestrator] Failed to parse LLM response. Raw response (first 1000 chars):', finalResponse.slice(0, 1000));
  } else {
    console.log(`[orchestrator] Generated workflow: ${workflow.name} — ${workflow.nodes.length} nodes, ${workflow.edges.length} edges`);
    // Validate node types — warn about unknown types
    for (const node of workflow.nodes) {
      if (!availableNodeTypes.includes(node.type)) {
        console.warn(`[orchestrator] Unknown node type: ${node.type} — will fall back to default rendering`);
      }
    }
  }

  // Store chat messages
  if (workflowId) {
    await db.insert(orchestratorChats).values({
      workflowId,
      role: 'user',
      content: userMessage,
    });

    const explanation = workflow?.explanation || 'I generated a workflow but could not parse the result.';
    await db.insert(orchestratorChats).values({
      workflowId,
      role: 'assistant',
      content: explanation,
      metadata: {
        workflowGenerated: !!workflow,
        tokensUsed,
      },
    });
  }

  return { workflow, messages };
}

export async function modifyWorkflow(
  userMessage: string,
  workflowId: string,
  currentNodes: WorkflowNodeDef[],
  currentEdges: WorkflowEdgeDef[],
  onChunk?: (text: string) => void,
): Promise<GeneratedWorkflow | null> {
  const client = getOpenAIClient();
  const model = getModel();

  onChunk?.('Modifying workflow...\n');

  const modifySystem = buildModifyPrompt(
    { nodes: currentNodes, edges: currentEdges },
    availableNodeTypes,
  );

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: modifySystem },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.7,
    max_tokens: 4096,
  });

  const text = response.choices[0]?.message?.content ?? '';
  const workflow = parseWorkflowResponse(text);

  // Store chat messages
  await db.insert(orchestratorChats).values({
    workflowId,
    role: 'user',
    content: userMessage,
  });

  await db.insert(orchestratorChats).values({
    workflowId,
    role: 'assistant',
    content: workflow?.explanation || text.slice(0, 500),
    metadata: { workflowGenerated: !!workflow },
  });

  return workflow;
}

export async function getChatHistory(workflowId: string): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(orchestratorChats)
    .where(eq(orchestratorChats.workflowId, workflowId))
    .orderBy(asc(orchestratorChats.createdAt));

  return rows.map((r) => ({
    id: r.id,
    role: r.role as ChatMessage['role'],
    content: r.content,
    metadata: r.metadata as ChatMessage['metadata'],
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function saveWorkflowFromGenerated(
  workflowId: string,
  generated: GeneratedWorkflow,
): Promise<void> {
  // Delete existing nodes/edges
  await db.delete(workflowNodes).where(eq(workflowNodes.workflowId, workflowId));
  await db.delete(workflowEdges).where(eq(workflowEdges.workflowId, workflowId));

  // Update workflow name/description
  await db.update(workflows).set({
    name: generated.name,
    description: generated.description || null,
    updatedAt: new Date(),
  }).where(eq(workflows.id, workflowId));

  // Insert new nodes
  if (generated.nodes.length > 0) {
    await db.insert(workflowNodes).values(
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

  // Insert new edges
  if (generated.edges.length > 0) {
    await db.insert(workflowEdges).values(
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
}
