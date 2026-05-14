import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import { db } from '$lib/db';
import { orchestratorChats, workflows, workflowNodes, workflowEdges, nodeExecutions } from '$lib/db/schema';
import { getCompiledPrompt } from '$lib/workflows/prompts/loader';
import { eq, asc, desc, and, isNotNull } from 'drizzle-orm';
import { buildToolUseSystemPrompt, buildCriticPrompt, buildRevisionPrompt, buildModifySystemPrompt } from './prompts';
import { buildNodeGrounding, type ExecutionExample } from './grounding';
import { buildWorkspaceResources } from './workspace-grounding';
import { openaiTools, toolSchemas } from './tools';
import { processToolCall, assembleWorkflow, resetNodeCounter } from './loop';
import type { ToolCallDeps } from './loop';
import { saveDynamicNode, validateExecutorSyntax, DYNAMIC_NODES_DIR } from './dynamic-nodes';
import { verifyWorkflow, formatIssues } from './verify';
import { nodeDefinitions } from '../registry-client';
import { registry, engine } from '../index';
import { randomUUID } from 'crypto';
import type { GeneratedWorkflow, ChatMessage, WorkflowDraft, OrchestratorThinking, CritiqueIssue, RevisionDelta } from './types';
import { serializeDraft, deserializeDraft } from './draft-serde';
import type { WorkflowNodeDef, WorkflowEdgeDef, JsonSchema } from '../types';

const MAX_TOOL_ROUNDS = 30;
const MAX_VERIFY_ROUNDS = 3;
const MAX_BEHAVIOURAL_VERIFY_ROUNDS = 3;

/**
 * Plain-English status line for one generator tool call. Surfaces in the
 * heartbeat as `currentStep` so the user sees "Adding cron trigger node"
 * rather than "use_node: {nodeType: 'trigger', config: {...}, ...}".
 *
 * `draft` is optional — when supplied, IDs in connect/update calls are
 * resolved to the human label of the node so the user sees
 * "Wiring Every 5 minutes → Query TV State" instead of
 * "Wiring trigger-1472b824-1 → home-assistant-1472b824-2".
 */
function humaniseGeneratorStep(
  fnName: string,
  fnArgs: Record<string, unknown>,
  draft?: WorkflowDraft,
): string {
  const s = (k: string): string | undefined => {
    const v = fnArgs[k];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  const trim = (txt: string, n = 60) => (txt.length > n ? txt.slice(0, n) + '…' : txt);
  const labelOf = (id: string | undefined): string | undefined => {
    if (!id || !draft) return id;
    return draft.nodes.get(id)?.label ?? id;
  };
  // Append the model's `reason` field to a step description when present —
  // turns "Adding Daily 9am Cron (trigger)" into
  // "Adding Daily 9am Cron (trigger) — to schedule the daily check".
  const withReason = (head: string): string => {
    const reason = s('reason');
    return reason ? `${head} — ${trim(reason, 80)}` : head;
  };
  switch (fnName) {
    case 'search_nodes':
      return s('query')
        ? `Searching the node registry for "${trim(s('query')!, 40)}" — looking for a node that fits`
        : 'Searching the node registry for a fitting node';
    case 'use_node': {
      const head = s('label')
        ? `Adding ${s('label')} (${s('nodeType') ?? 'node'}) to the canvas`
        : (s('nodeType') ? `Adding a ${s('nodeType')} node to the canvas` : 'Adding a node to the canvas');
      return withReason(head);
    }
    case 'update_node': {
      const id = s('id');
      const label = labelOf(id);
      const head = label
        ? `Updating ${label} — applying a config change`
        : 'Updating a node\'s config';
      return withReason(head);
    }
    case 'create_node': {
      const head = s('label')
        ? `Creating a brand new node type "${s('label')}" — no existing one fits`
        : 'Creating a brand new node type — no existing one fits';
      return withReason(head);
    }
    case 'connect_nodes': {
      const sourceLabel = labelOf(s('sourceId'));
      const targetLabel = labelOf(s('targetId'));
      const head = (sourceLabel && targetLabel)
        ? `Wiring ${sourceLabel} → ${targetLabel} so output flows downstream`
        : 'Wiring nodes so output flows downstream';
      return withReason(head);
    }
    case 'set_trigger': {
      const head = s('type')
        ? `Setting trigger to ${s('type')} — that's what fires this workflow`
        : 'Setting the trigger that fires this workflow';
      return withReason(head);
    }
    case 'finalize_workflow':
      return s('name')
        ? `Finalising "${s('name')}" — workflow shape is done, ready for review`
        : 'Finalising the workflow — ready for review';
    case 'ask_user':
      return s('question')
        ? `Asking the user a clarifying question: ${trim(s('question')!, 50)}`
        : 'Asking the user a clarifying question';
    case 'scraper_target_knowledge_lookup': {
      const domains = fnArgs.domains;
      if (Array.isArray(domains) && typeof domains[0] === 'string') {
        return `Looking up scraper target ${trim(domains[0] as string, 50)} — checking what's already known`;
      }
      return 'Looking up scraper target — checking what\'s already known';
    }
    default: {
      // Generic fallback: first short string arg, or just the tool name.
      for (const v of Object.values(fnArgs)) {
        if (typeof v === 'string' && v.length > 0 && v.length < 80) return `${fnName}: ${trim(v, 50)}`;
      }
      return fnName;
    }
  }
}

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

function getOutputSchema(type: string, config: Record<string, unknown>): JsonSchema {
  const executor = registry.getExecutor(type);
  if (executor) return executor.getOutputSchema(config);
  return { type: 'object' };
}

function getToolCallDeps(): ToolCallDeps {
  const builtinTypes = new Set(nodeDefinitions.map(d => d.type));
  return {
    searchFn: (query: string, category?: string) =>
      registry.search(query, category as any),
    builtinTypes,
    getOutputSchema,
    getDefinition: (type: string) => registry.getDefinition(type),
  };
}

async function runToolLoop(
  systemPrompt: string,
  userMessage: string,
  conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  onChunk?: (text: string) => void,
  existingDraft?: WorkflowDraft,
  workflowId?: string | null,
  opts?: { skipVerification?: boolean },
): Promise<{
  draft: WorkflowDraft;
  name: string;
  description?: string;
  followUp?: string;
}> {
  const client = getOpenAIClient();
  const model = getModel();
  const draft = existingDraft ?? createEmptyDraft();
  if (!existingDraft) resetNodeCounter();
  const deps = getToolCallDeps();
  const tools = opts?.skipVerification
    ? openaiTools.filter((t) => t.function?.name !== 'verify_workflow')
    : openaiTools;

  const messages: Array<any> = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  let workflowName = 'Generated Workflow';
  let workflowDescription: string | undefined;
  let verifyAttempts = 0;
  let behaviouralVerifyAttempts = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Retry with backoff on 429 rate limits
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await client.chat.completions.create({
          model,
          messages,
          tools: tools as any,
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

      onChunk?.(`${humaniseGeneratorStep(fnName, fnArgs, draft)}\n`);

      // --- Async tool: scraper_target_knowledge_lookup ---
      if (fnName === 'scraper_target_knowledge_lookup') {
        try {
          const { lookupByDomains } = await import('$lib/workflows/scraper/target-knowledge');
          const domains = Array.isArray(fnArgs.domains) ? fnArgs.domains as string[] : [];
          const rows = await lookupByDomains(domains);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ success: true, data: rows }),
          });
        } catch (err: any) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ success: false, error: err?.message ?? 'lookup failed' }),
          });
        }
        continue;
      }

      // --- Async tool: verify_workflow (behavioural dry-run check) ---
      if (fnName === 'verify_workflow') {
        if (behaviouralVerifyAttempts >= MAX_BEHAVIOURAL_VERIFY_ROUNDS) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              success: false,
              error: `Verification limit reached (${MAX_BEHAVIOURAL_VERIFY_ROUNDS}). Call finalize_workflow next, or stop and ask the user for guidance.`,
            }),
          });
          continue;
        }
        behaviouralVerifyAttempts++;
        try {
          const draftWorkflow = assembleWorkflow(
            draft,
            workflowName ?? 'draft',
            workflowDescription ?? '',
          );
          const dbgRunId = `dbg_${randomUUID()}`;
          const initialInput =
            fnArgs.initialInput && typeof fnArgs.initialInput === 'object'
              ? (fnArgs.initialInput as Record<string, unknown>)
              : {};

          // engine.execute() needs a WorkflowDefinition with an id. The
          // GeneratedWorkflow returned by assembleWorkflow has no id, so we
          // synthesise one (the run is ephemeral — id is only used for
          // workspaceDir / data-store keying inside the engine).
          const definition = {
            id: workflowId ?? `draft-${dbgRunId}`,
            name: draftWorkflow.name,
            nodes: draftWorkflow.nodes,
            edges: draftWorkflow.edges,
          };

          const result = await engine.execute(
            definition,
            dbgRunId,
            initialInput,
            undefined,
            workflowId ?? undefined,
            { dryRun: true },
          );

          // Cap any string field at 500 chars before sending the captureLog
          // to the LLM — a single intel-write or email body can otherwise be
          // many KB, and across 3 rounds that can blow the context window.
          const truncate = (v: unknown): unknown => {
            if (typeof v === 'string') {
              return v.length > 500 ? `${v.slice(0, 500)}…[truncated, ${v.length} chars total]` : v;
            }
            if (Array.isArray(v)) return v.map(truncate);
            if (v && typeof v === 'object') {
              const out: Record<string, unknown> = {};
              for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = truncate(val);
              return out;
            }
            return v;
          };

          const captureLog: Array<{ nodeId: string; nodeType: string; capture: unknown }> = [];
          for (const [nodeId, output] of result.nodeOutputs.entries()) {
            if (
              output &&
              typeof output === 'object' &&
              (output as { simulated?: unknown }).simulated === true
            ) {
              const nodeType = definition.nodes.find((n) => n.id === nodeId)?.type ?? 'unknown';
              captureLog.push({ nodeId, nodeType, capture: truncate(output) });
            }
          }

          onChunk?.(
            `Verification round ${behaviouralVerifyAttempts}/${MAX_BEHAVIOURAL_VERIFY_ROUNDS}: ${captureLog.length} simulated send(s)\n`,
          );

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(
              {
                success: true,
                verificationRound: behaviouralVerifyAttempts,
                maxRounds: MAX_BEHAVIOURAL_VERIFY_ROUNDS,
                runStatus: result.status,
                captureLog,
                errors: Object.fromEntries(result.nodeErrors),
              },
              null,
              2,
            ),
          });
        } catch (err: any) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              success: false,
              error: err?.message ?? 'verify_workflow failed',
            }),
          });
        }
        continue;
      }

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

        // --- Post-finalize verification ---
        const assembled = assembleWorkflow(draft, workflowName, workflowDescription);
        const issues = verifyWorkflow(
          assembled.nodes,
          assembled.edges,
          (type) => registry.getDefinition(type),
          getOutputSchema,
        );

        if (issues.length > 0 && verifyAttempts < MAX_VERIFY_ROUNDS) {
          verifyAttempts++;
          const issueText = formatIssues(issues);
          onChunk?.(`Verification round ${verifyAttempts}: found ${issues.length} issue(s), asking builder to fix...\n`);

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              success: false,
              error: issueText,
            }),
          });
          continue; // Re-enter the tool loop so the LLM can fix issues
        }

        if (issues.length > 0) {
          onChunk?.(`Verification: ${issues.length} issue(s) remain after ${verifyAttempts} rounds — proceeding with warnings.\n`);
        } else if (verifyAttempts > 0) {
          onChunk?.('Verification passed after corrections.\n');
        }

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
  opts?: { skipVerification?: boolean },
): Promise<{
  workflow: GeneratedWorkflow | null;
  followUp?: string;
  thinking?: OrchestratorThinking;
  messages: ChatMessage[];
}> {
  const grounding = await buildGrounding();
  const workspaceResources = await buildWorkspaceResources(workflowId);
  const personalityPrompt = await getCompiledPrompt();
  const basePrompt = buildToolUseSystemPrompt(grounding, workspaceResources, opts);
  const systemPrompt = personalityPrompt
    ? `${personalityPrompt}\n\n---\n\n${basePrompt}`
    : basePrompt;

  let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (workflowId) {
    const history = await getChatHistory(workflowId);
    conversationHistory = history.map(h => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    }));
  }

  onChunk?.('Planning workflow — picking the nodes and how they wire together.\n');

  // Check for a persisted draft from a previous ask_user turn.
  // NOTE: We take the most recent draftState. If the user completes a workflow
  // and starts a new topic, a stale draft from before might be rehydrated —
  // acceptable for now since modify-workflow is the expected flow post-completion.
  let existingDraft: WorkflowDraft | undefined;
  if (workflowId && conversationHistory.length > 0) {
    const recentChats = await db
      .select()
      .from(orchestratorChats)
      .where(eq(orchestratorChats.workflowId, workflowId))
      .orderBy(desc(orchestratorChats.createdAt))
      .limit(10);

    for (const row of recentChats) {
      const meta = row.metadata as Record<string, unknown> | null;
      if (meta?.draftState) {
        existingDraft = deserializeDraft(meta.draftState as Record<string, unknown>);
        break;
      }
    }
  }

  const { draft, name, description, followUp } = await runToolLoop(
    systemPrompt,
    userMessage,
    conversationHistory,
    onChunk,
    existingDraft,
    workflowId,
    opts,
  );

  if (followUp) {
    if (workflowId) {
      await db.insert(orchestratorChats).values({ workflowId, role: 'user', content: userMessage });
      await db.insert(orchestratorChats).values({
        workflowId,
        role: 'assistant',
        content: followUp,
        metadata: { draftState: serializeDraft(draft) },
      });
    }
    return { workflow: null, followUp, messages: [] };
  }

  if (draft.nodes.size === 0) {
    return { workflow: null, messages: [] };
  }

  const workflow = assembleWorkflow(draft, name, description);

  if (workflow.warnings && workflow.warnings.length > 0) {
    for (const warning of workflow.warnings) {
      onChunk?.(`⚠️  ${warning}\n`);
    }
  }

  // Plan summary — surface the proposed shape before the critic round so
  // the user sees what's being built (not just a stream of "Adding…" lines).
  // Format: Plan: "<name>" — N nodes (type1, type2, type3), M edges
  {
    const nodeTypes = Array.from(new Set(Array.from(draft.nodes.values()).map(n => n.type)));
    const typesPreview = nodeTypes.slice(0, 6).join(', ') + (nodeTypes.length > 6 ? `, +${nodeTypes.length - 6} more` : '');
    onChunk?.(`Plan: "${name}" — ${draft.nodes.size} nodes (${typesPreview}), ${draft.edges.length} edges\n`);
  }

  onChunk?.('Reviewing the workflow with the critic — checking for missing pieces and bad wiring.\n');
  const criticResult = await runCriticRound(workflow, draft);

  let revisions: RevisionDelta[] = [];
  let finalWorkflow = workflow;

  let finalDraft = draft;

  if (criticResult.verdict === 'fail' && criticResult.issues.length > 0) {
    onChunk?.('Revising the workflow based on the critic\'s feedback — fixing the issues raised.\n');

    const issuesSummary = criticResult.issues
      .map((i) => `- [${i.severity}] ${i.nodeId ? `Node ${i.nodeId}: ` : ''}${i.message}`)
      .join('\n');

    const workflowSummary = JSON.stringify({
      name: workflow.name,
      nodes: workflow.nodes.map(n => ({ id: n.id, type: n.type, label: n.label, config: n.config })),
      edges: workflow.edges.map(e => ({ source: e.sourceNodeId, target: e.targetNodeId, sourceHandle: e.sourceHandle })),
    }, null, 2);

    const revisionPrompt = buildRevisionPrompt(opts);
    const workspaceSection = workspaceResources && workspaceResources.trim().length > 0
      ? `\n\n## Workspace Resources\n\n${workspaceResources}`
      : '';
    const revisionSystem = `${revisionPrompt}\n\n## Node Registry\n\n${grounding}${workspaceSection}`;

    try {
      const revisionResult = await runToolLoop(
        revisionSystem,
        `## Existing Workflow\n\n\`\`\`json\n${workflowSummary}\n\`\`\`\n\n## Issues Found\n\n${issuesSummary}\n\nFix these issues using the available tools, then call finalize_workflow. You can call use_node on existing node IDs to update their config, or connect_nodes to rewire.`,
        [],
        onChunk,
        draft, // Pass the existing draft so revision builds on it
        workflowId,
        opts,
      );

      if (revisionResult.draft.nodes.size > 0) {
        finalDraft = revisionResult.draft;
        finalWorkflow = assembleWorkflow(finalDraft, revisionResult.name || name, revisionResult.description || description);
        if (finalWorkflow.warnings && finalWorkflow.warnings.length > 0) {
          for (const warning of finalWorkflow.warnings) {
            onChunk?.(`⚠️  ${warning}\n`);
          }
        }
        onChunk?.('Revision complete — workflow is ready to save.\n');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onChunk?.(`Revision round failed: ${msg} — proceeding with original workflow.\n`);
    }

    revisions = criticResult.issues.map(i => ({
      action: 'modified' as const,
      nodeId: i.nodeId,
      description: `${i.severity}: ${i.message}`,
    }));
  }

  if (finalDraft.newNodeTypes.length > 0) {
    onChunk?.('Registering new node types — adding them to the registry before save.\n');
    await saveDynamicNodes(finalDraft);
  }

  const thinking = buildThinking(finalDraft, finalWorkflow, criticResult, revisions);

  if (workflowId) {
    await db.insert(orchestratorChats).values({
      workflowId,
      role: 'user',
      content: userMessage,
    });
    const warningText = finalWorkflow.warnings?.length
      ? `⚠️ ${finalWorkflow.warnings.join('\n⚠️ ')}\n\n`
      : '';
    await db.insert(orchestratorChats).values({
      workflowId,
      role: 'assistant',
      content: warningText + (finalWorkflow.explanation || 'Workflow generated.'),
      metadata: { workflowGenerated: true, draftState: null },
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
  const workspaceResources = await buildWorkspaceResources(workflowId);
  const personalityPrompt = await getCompiledPrompt();
  const baseModifyPrompt = buildModifySystemPrompt(
    { nodes: currentNodes, edges: currentEdges },
    grounding,
    workspaceResources,
  );
  const systemPrompt = personalityPrompt
    ? `${personalityPrompt}\n\n---\n\n${baseModifyPrompt}`
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
    undefined,
    workflowId,
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

  if (workflow.warnings && workflow.warnings.length > 0) {
    for (const warning of workflow.warnings) {
      onChunk?.(`⚠️  ${warning}\n`);
    }
  }

  if (draft.newNodeTypes.length > 0) {
    await saveDynamicNodes(draft);
  }

  const thinking = buildThinking(draft, workflow, { issues: [], verdict: 'pass' }, []);

  await db.insert(orchestratorChats).values({ workflowId, role: 'user', content: userMessage });
  const warningText = workflow.warnings?.length
    ? `⚠️ ${workflow.warnings.join('\n⚠️ ')}\n\n`
    : '';
  await db.insert(orchestratorChats).values({
    workflowId,
    role: 'assistant',
    content: warningText + (workflow.explanation || 'Workflow modified.'),
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
