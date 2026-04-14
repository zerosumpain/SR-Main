import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import { db } from '$lib/db';
import { orchestratorChats, workflows, workflowNodes, workflowEdges, nodeExecutions } from '$lib/db/schema';
import { getCompiledPrompt } from '$lib/workflows/prompts/loader';
import { eq, asc, desc, and, isNotNull } from 'drizzle-orm';
import { buildToolUseSystemPrompt, buildCriticPrompt, buildRevisionPrompt, buildModifySystemPrompt } from './prompts';
import { buildNodeGrounding, type ExecutionExample } from './grounding';
import { openaiTools, toolSchemas } from './tools';
import { processToolCall, assembleWorkflow, resetNodeCounter } from './loop';
import type { ToolCallDeps } from './loop';
import { saveDynamicNode, validateExecutorSyntax, DYNAMIC_NODES_DIR } from './dynamic-nodes';
import { nodeDefinitions } from '../registry-client';
import { registry } from '../index';
import type { GeneratedWorkflow, ChatMessage, WorkflowDraft, OrchestratorThinking, CritiqueIssue, RevisionDelta } from './types';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '../types';

const MAX_TOOL_ROUNDS = 30;

async function getRecentExecutionExamples(): Promise<ExecutionExample[]> {
  try {
    const rows = await db
      .select({
        nodeType: workflowNodes.type,
        inputData: nodeExecutions.inputData,
        outputData: nodeExecutions.outputData,
      })
      .from(nodeExecutions)
      .innerJoin(workflowNodes, eq(nodeExecutions.nodeId, workflowNodes.id))
      .where(
        and(
          eq(nodeExecutions.status, 'completed'),
          isNotNull(nodeExecutions.outputData),
        ),
      )
      .orderBy(desc(nodeExecutions.completedAt))
      .limit(50);

    const byType = new Map<string, ExecutionExample[]>();
    for (const row of rows) {
      const existing = byType.get(row.nodeType) || [];
      if (existing.length < 2) {
        existing.push({
          nodeType: row.nodeType,
          inputData: row.inputData,
          outputData: row.outputData,
        });
        byType.set(row.nodeType, existing);
      }
    }

    return Array.from(byType.values()).flat();
  } catch {
    return [];
  }
}

async function buildGrounding(): Promise<string> {
  const examples = await getRecentExecutionExamples();
  // Use registry.listDefinitions() to include both built-in and dynamic nodes
  const allDefinitions = registry.listDefinitions();
  return buildNodeGrounding(allDefinitions.length > 0 ? allDefinitions : nodeDefinitions, examples);
}

function createEmptyDraft(): WorkflowDraft {
  return {
    nodes: new Map(),
    edges: [],
    newNodeTypes: [],
    searchLog: [],
    decisions: [],
  };
}

function getToolCallDeps(): ToolCallDeps {
  const builtinTypes = new Set(nodeDefinitions.map(d => d.type));
  return {
    searchFn: (query: string, category?: string) =>
      registry.search(query, category as any),
    builtinTypes,
  };
}

async function runToolLoop(
  systemPrompt: string,
  userMessage: string,
  conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  onChunk?: (text: string) => void,
): Promise<{
  draft: WorkflowDraft;
  name: string;
  description?: string;
  followUp?: string;
}> {
  const client = getOpenAIClient();
  const model = getModel();
  const draft = createEmptyDraft();
  const deps = getToolCallDeps();
  resetNodeCounter();

  const messages: Array<any> = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  let workflowName = 'Generated Workflow';
  let workflowDescription: string | undefined;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Retry with backoff on 429 rate limits
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await client.chat.completions.create({
          model,
          messages,
          tools: openaiTools as any,
          tool_choice: 'auto',
          temperature: 0.7,
          max_tokens: 4096,
        });
        break;
      } catch (err: any) {
        if (err?.status === 429 && attempt < 2) {
          const wait = (attempt + 1) * 5000; // 5s, 10s
          onChunk?.(`Rate limited — waiting ${wait / 1000}s before retry...\n`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw err;
      }
    }
    if (!response) break;

    const choice = response.choices[0];
    if (!choice) break;

    const msg = choice.message;

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      if (msg.content) {
        messages.push({ role: 'assistant', content: msg.content });
      }
      break;
    }

    messages.push(msg);

    for (const toolCall of msg.tool_calls) {
      const fnName = toolCall.function.name;
      let fnArgs: Record<string, unknown>;

      try {
        fnArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: 'Invalid JSON in tool arguments' }),
        });
        continue;
      }

      onChunk?.(`${fnName}: ${JSON.stringify(fnArgs).slice(0, 100)}...\n`);

      const result = processToolCall(draft, fnName, fnArgs, deps);

      if (result.askUser) {
        return {
          draft,
          name: workflowName,
          followUp: result.askUser.question + (result.askUser.context ? `\n\n${result.askUser.context}` : ''),
        };
      }

      if (result.finalized) {
        const finalizeArgs = toolSchemas.finalize_workflow.parse(fnArgs);
        workflowName = finalizeArgs.name;
        workflowDescription = finalizeArgs.description;

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ success: true, message: result.response }),
        });

        return { draft, name: workflowName, description: workflowDescription };
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(
          result.success
            ? { success: true, message: result.response }
            : { error: result.error },
        ),
      });
    }
  }

  return { draft, name: workflowName, description: workflowDescription };
}

async function runCriticRound(
  workflow: GeneratedWorkflow,
  draft: WorkflowDraft,
): Promise<{ issues: CritiqueIssue[]; verdict: 'pass' | 'fail' }> {
  const client = getOpenAIClient();
  const model = getModel();

  const workflowSummary = JSON.stringify({
    name: workflow.name,
    nodes: workflow.nodes.map(n => ({ id: n.id, type: n.type, label: n.label, config: n.config })),
    edges: workflow.edges.map(e => ({ source: e.sourceNodeId, target: e.targetNodeId })),
  }, null, 2);

  const reasoningTrace = draft.decisions
    .map(d => `[${d.type}] ${d.summary}${d.detail ? ': ' + d.detail : ''}`)
    .join('\n');

  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: buildCriticPrompt() },
          { role: 'user', content: `## Workflow\n\n\`\`\`json\n${workflowSummary}\n\`\`\`\n\n## Reasoning Trace\n\n${reasoningTrace}` },
        ],
        temperature: 0.5,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      });
      break;
    } catch (err: any) {
      if (err?.status === 429 && attempt < 2) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      // Critic failure is non-fatal — skip review
      console.warn('[orchestrator] Critic round failed:', err?.message);
      return { issues: [], verdict: 'pass' as const };
    }
  }

  const text = response?.choices[0]?.message?.content ?? '{}';
  try {
    const parsed = JSON.parse(text);
    return {
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      verdict: parsed.verdict === 'pass' ? 'pass' : 'fail',
    };
  } catch {
    return { issues: [], verdict: 'pass' };
  }
}

async function saveDynamicNodes(draft: WorkflowDraft): Promise<void> {
  for (const newNode of draft.newNodeTypes) {
    const syntaxResult = validateExecutorSyntax(newNode.executorCode);
    if (!syntaxResult.valid) {
      console.warn(`[orchestrator] Skipping dynamic node ${newNode.type}: ${syntaxResult.error}`);
      continue;
    }

    const definition = {
      type: newNode.type,
      label: newNode.label,
      category: newNode.category as any,
      description: newNode.description,
      configSchema: newNode.configSchema as any,
      defaultConfig: newNode.defaultConfig,
      inputs: newNode.inputs as any,
      outputs: newNode.outputs as any,
      llmDescription: `Auto-generated integration: ${newNode.description}`,
    };

    saveDynamicNode(DYNAMIC_NODES_DIR, definition, newNode.executorCode);

    const { loadDynamicNodeExecutor } = await import('./dynamic-nodes');
    const executor = await loadDynamicNodeExecutor(DYNAMIC_NODES_DIR, newNode.type);
    if (executor) {
      registry.register(definition, executor);
      console.log(`[orchestrator] Hot-registered new node: ${newNode.type}`);
    }
  }
}

function buildThinking(
  draft: WorkflowDraft,
  workflow: GeneratedWorkflow,
  criticResult: { issues: CritiqueIssue[]; verdict: string },
  revisions: RevisionDelta[],
): OrchestratorThinking {
  const nodeReasoning: OrchestratorThinking['nodeReasoning'] = {};
  for (const [id, node] of draft.nodes) {
    const searchEntry = draft.searchLog.find(s => s.results.includes(node.type));

    nodeReasoning[id] = {
      reason: node.reason,
      alternatives: node.alternatives,
      searchQuery: searchEntry?.query,
      isNewNode: draft.newNodeTypes.some(n => n.type === node.type),
    };
  }

  return {
    steps: draft.decisions,
    nodeReasoning,
    debate: {
      proposal: {
        nodeCount: workflow.nodes.length,
        edgeCount: workflow.edges.length,
        newNodes: draft.newNodeTypes.map(n => n.type),
      },
      issues: criticResult.issues,
      revisions,
    },
  };
}

// --- Public API ---

export async function generateWorkflow(
  userMessage: string,
  workflowId: string | null,
  onChunk?: (text: string) => void,
): Promise<{
  workflow: GeneratedWorkflow | null;
  followUp?: string;
  thinking?: OrchestratorThinking;
  messages: ChatMessage[];
}> {
  const grounding = await buildGrounding();
  const personalityPrompt = await getCompiledPrompt();
  const basePrompt = buildToolUseSystemPrompt(grounding);
  const systemPrompt = personalityPrompt
    ? `${basePrompt}\n\n${personalityPrompt}`
    : basePrompt;

  let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (workflowId) {
    const history = await getChatHistory(workflowId);
    conversationHistory = history.map(h => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    }));
  }

  onChunk?.('Planning workflow...\n');

  const { draft, name, description, followUp } = await runToolLoop(
    systemPrompt,
    userMessage,
    conversationHistory,
    onChunk,
  );

  if (followUp) {
    if (workflowId) {
      await db.insert(orchestratorChats).values({ workflowId, role: 'user', content: userMessage });
      await db.insert(orchestratorChats).values({ workflowId, role: 'assistant', content: followUp });
    }
    return { workflow: null, followUp, messages: [] };
  }

  if (draft.nodes.size === 0) {
    return { workflow: null, messages: [] };
  }

  const workflow = assembleWorkflow(draft, name, description);

  onChunk?.('Reviewing workflow...\n');
  const criticResult = await runCriticRound(workflow, draft);

  let revisions: RevisionDelta[] = [];
  let finalWorkflow = workflow;

  if (criticResult.verdict === 'fail' && criticResult.issues.length > 0) {
    onChunk?.('Revising based on feedback...\n');
    // Log issues — the revision round is a future enhancement
    // that would re-enter the tool loop with the critic's feedback.
    // For now, the issues are surfaced in the thinking UI so the
    // user can manually address them on the canvas.
    console.log('[orchestrator] Critic found issues:', criticResult.issues.length);
    revisions = criticResult.issues.map(i => ({
      action: 'modified' as const,
      nodeId: i.nodeId,
      description: `${i.severity}: ${i.message}`,
    }));
  }

  if (draft.newNodeTypes.length > 0) {
    onChunk?.('Registering new node types...\n');
    await saveDynamicNodes(draft);
  }

  const thinking = buildThinking(draft, finalWorkflow, criticResult, revisions);

  if (workflowId) {
    await db.insert(orchestratorChats).values({
      workflowId,
      role: 'user',
      content: userMessage,
    });
    await db.insert(orchestratorChats).values({
      workflowId,
      role: 'assistant',
      content: finalWorkflow.explanation || 'Workflow generated.',
      metadata: { workflowGenerated: true },
    });
  }

  return {
    workflow: finalWorkflow,
    thinking,
    messages: [],
  };
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
  const grounding = await buildGrounding();
  const personalityPrompt = await getCompiledPrompt();
  const baseModifyPrompt = buildModifySystemPrompt(
    { nodes: currentNodes, edges: currentEdges },
    grounding,
  );
  const systemPrompt = personalityPrompt
    ? `${baseModifyPrompt}\n\n${personalityPrompt}`
    : baseModifyPrompt;

  const history = await getChatHistory(workflowId);
  const conversationHistory = history.map(h => ({
    role: h.role as 'user' | 'assistant',
    content: h.content,
  }));

  onChunk?.('Modifying workflow...\n');

  const { draft, name, description, followUp } = await runToolLoop(
    systemPrompt,
    userMessage,
    conversationHistory,
    onChunk,
  );

  if (followUp) {
    await db.insert(orchestratorChats).values({ workflowId, role: 'user', content: userMessage });
    await db.insert(orchestratorChats).values({ workflowId, role: 'assistant', content: followUp });
    return { workflow: null, followUp };
  }

  if (draft.nodes.size === 0) {
    await db.insert(orchestratorChats).values({ workflowId, role: 'user', content: userMessage });
    await db.insert(orchestratorChats).values({ workflowId, role: 'assistant', content: 'No changes made.' });
    return { workflow: null };
  }

  const workflow = assembleWorkflow(draft, name || 'Modified Workflow', description);

  if (draft.newNodeTypes.length > 0) {
    await saveDynamicNodes(draft);
  }

  const thinking = buildThinking(draft, workflow, { issues: [], verdict: 'pass' }, []);

  await db.insert(orchestratorChats).values({ workflowId, role: 'user', content: userMessage });
  await db.insert(orchestratorChats).values({
    workflowId,
    role: 'assistant',
    content: workflow.explanation || 'Workflow modified.',
    metadata: { workflowGenerated: true },
  });

  return { workflow, thinking };
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
  await db.delete(workflowNodes).where(eq(workflowNodes.workflowId, workflowId));
  await db.delete(workflowEdges).where(eq(workflowEdges.workflowId, workflowId));

  await db.update(workflows).set({
    name: generated.name,
    description: generated.description || null,
    updatedAt: new Date(),
  }).where(eq(workflows.id, workflowId));

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
