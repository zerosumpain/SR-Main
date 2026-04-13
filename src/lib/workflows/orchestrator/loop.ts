import type { NodeDefinition } from '../types';
import type { GeneratedWorkflow, WorkflowDraft, ThinkingStep } from './types';
import { toolSchemas } from './tools';
import { autoLayout } from './layout';

export interface ToolCallDeps {
  searchFn?: (query: string, category?: string) => NodeDefinition[];
  builtinTypes?: Set<string>;
}

export interface ToolCallResult {
  success: boolean;
  response?: string;
  error?: string;
  finalized?: boolean;
  askUser?: { question: string; context?: string };
}

let nodeCounter = 0;
let runPrefix = '';

function randomHex(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function nextNodeId(type: string): string {
  return `${type}-${runPrefix}-${++nodeCounter}`;
}

function nextEdgeId(): string {
  return `edge-${runPrefix}-${++nodeCounter}`;
}

export function resetNodeCounter(): void {
  nodeCounter = 0;
  runPrefix = randomHex(4);
}

export function processToolCall(
  draft: WorkflowDraft,
  toolName: string,
  args: Record<string, unknown>,
  deps: ToolCallDeps,
): ToolCallResult {
  const now = Date.now();

  switch (toolName) {
    case 'search_nodes': {
      const parsed = toolSchemas.search_nodes.safeParse(args);
      if (!parsed.success) {
        return { success: false, error: `Validation failed: ${parsed.error.issues.map(i => i.message).join(', ')}` };
      }
      const { query, category } = parsed.data;
      const results = deps.searchFn?.(query, category) ?? [];
      const resultTypes = results.map(d => d.type);

      draft.searchLog.push({ query, results: resultTypes, timestamp: now });
      draft.decisions.push({
        type: 'search',
        summary: `Searched: "${query}"${category ? ` (${category})` : ''}`,
        detail: resultTypes.length > 0
          ? `Found: ${results.map(d => `${d.label} (\`${d.type}\`)`).join(', ')}`
          : 'No matching nodes found',
        timestamp: now,
      });

      if (results.length === 0) {
        return { success: true, response: `No nodes found matching "${query}". Consider using create_node to build a new integration, or try a different search query.` };
      }

      const desc = results.map(d => {
        const ports = `Inputs: ${d.inputs.map(p => p.name).join(', ') || 'none'} | Outputs: ${d.outputs.map(p => p.name).join(', ') || 'none'}`;
        return `- **${d.label}** (\`${d.type}\`): ${d.description}\n  ${ports}`;
      }).join('\n');

      return { success: true, response: `Found ${results.length} matching node(s):\n${desc}` };
    }

    case 'use_node': {
      const parsed = toolSchemas.use_node.safeParse(args);
      if (!parsed.success) {
        return { success: false, error: `Validation failed: ${parsed.error.issues.map(i => i.message).join(', ')}` };
      }
      const { nodeType, config, label, reason, alternativesConsidered } = parsed.data;
      const id = nextNodeId(nodeType);

      draft.nodes.set(id, {
        id,
        type: nodeType,
        config,
        label,
        reason,
        alternatives: alternativesConsidered,
      });

      draft.decisions.push({
        type: 'use_node',
        summary: `Added: ${label} (\`${nodeType}\`)`,
        detail: `Reason: ${reason}\nAlternatives: ${alternativesConsidered.map(a => `${a.nodeType} — ${a.whyRejected}`).join('; ')}`,
        nodeId: id,
        timestamp: now,
      });

      return { success: true, response: `Node "${label}" (${id}) added to workflow.` };
    }

    case 'create_node': {
      const parsed = toolSchemas.create_node.safeParse(args);
      if (!parsed.success) {
        return { success: false, error: `Validation failed: ${parsed.error.issues.map(i => i.message).join(', ')}` };
      }
      const data = parsed.data;

      if (deps.builtinTypes?.has(data.type)) {
        return { success: false, error: `Cannot create node type "${data.type}" — conflicts with a built-in node. Choose a different type name.` };
      }

      draft.newNodeTypes.push({
        ...data,
        defaultConfig: data.defaultConfig || {},
        inputs: data.inputs as Array<{ name: string; type: string }>,
        outputs: data.outputs as Array<{ name: string; type: string }>,
      });

      const id = nextNodeId(data.type);
      draft.nodes.set(id, {
        id,
        type: data.type,
        config: data.defaultConfig || {},
        label: data.label,
        reason: data.reason,
        alternatives: [],
      });

      draft.decisions.push({
        type: 'create_node',
        summary: `Created new node type: ${data.label} (\`${data.type}\`)`,
        detail: `Reason: ${data.reason}\n${data.description}`,
        nodeId: id,
        timestamp: now,
      });

      return { success: true, response: `New node type "${data.type}" created and added to workflow as ${id}. It will be saved as a reusable node after finalization.` };
    }

    case 'connect_nodes': {
      const parsed = toolSchemas.connect_nodes.safeParse(args);
      if (!parsed.success) {
        return { success: false, error: `Validation failed: ${parsed.error.issues.map(i => i.message).join(', ')}` };
      }
      const { sourceId, targetId, sourceHandle, targetHandle } = parsed.data;

      if (!draft.nodes.has(sourceId)) {
        return { success: false, error: `Source node "${sourceId}" does not exist in the workflow. Available nodes: ${Array.from(draft.nodes.keys()).join(', ')}` };
      }
      if (!draft.nodes.has(targetId)) {
        return { success: false, error: `Target node "${targetId}" does not exist in the workflow. Available nodes: ${Array.from(draft.nodes.keys()).join(', ')}` };
      }

      const edgeId = nextEdgeId();
      draft.edges.push({
        id: edgeId,
        source: sourceId,
        target: targetId,
        sourceHandle,
        targetHandle,
      });

      draft.decisions.push({
        type: 'connect',
        summary: `Connected: ${sourceId} → ${targetId}${sourceHandle ? ` (${sourceHandle})` : ''}`,
        timestamp: now,
      });

      return { success: true, response: `Edge ${edgeId}: ${sourceId} → ${targetId}` };
    }

    case 'ask_user': {
      const parsed = toolSchemas.ask_user.safeParse(args);
      if (!parsed.success) {
        return { success: false, error: `Validation failed: ${parsed.error.issues.map(i => i.message).join(', ')}` };
      }

      draft.decisions.push({
        type: 'ask_user',
        summary: `Asking user: ${parsed.data.question}`,
        detail: parsed.data.context,
        timestamp: now,
      });

      return { success: true, askUser: { question: parsed.data.question, context: parsed.data.context } };
    }

    case 'finalize_workflow': {
      const parsed = toolSchemas.finalize_workflow.safeParse(args);
      if (!parsed.success) {
        return { success: false, error: `Validation failed: ${parsed.error.issues.map(i => i.message).join(', ')}` };
      }

      draft.decisions.push({
        type: 'finalize',
        summary: `Finalized: "${parsed.data.name}"`,
        detail: parsed.data.description,
        timestamp: now,
      });

      return { success: true, finalized: true, response: `Workflow "${parsed.data.name}" finalized.` };
    }

    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

export function assembleWorkflow(
  draft: WorkflowDraft,
  name: string,
  description?: string,
): GeneratedWorkflow {
  const nodesArray = Array.from(draft.nodes.values());

  // Fallback: if the LLM didn't create any edges, auto-connect nodes sequentially
  if (draft.edges.length === 0 && nodesArray.length > 1) {
    console.warn('[orchestrator] No edges created by LLM — auto-connecting nodes in sequence');
    for (let i = 0; i < nodesArray.length - 1; i++) {
      draft.edges.push({
        id: nextEdgeId(),
        source: nodesArray[i].id,
        target: nodesArray[i + 1].id,
      });
    }
    draft.decisions.push({
      type: 'connect',
      summary: `Auto-connected ${draft.edges.length} edges (LLM did not call connect_nodes)`,
      timestamp: Date.now(),
    });
  }

  const layoutEdges = draft.edges.map(e => ({ source: e.source, target: e.target }));
  const positions = autoLayout(
    nodesArray.map(n => ({ id: n.id, type: n.type })),
    layoutEdges,
  );

  const nodes = nodesArray.map(n => ({
    id: n.id,
    type: n.type,
    position: positions.get(n.id) || { x: 0, y: 0 },
    config: { ...n.config, description: n.reason },
    label: n.label,
  }));

  const edges = draft.edges.map(e => ({
    id: e.id,
    sourceNodeId: e.source,
    targetNodeId: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
  }));

  const explanation = draft.decisions
    .filter(d => d.type !== 'search' && d.type !== 'connect')
    .map(d => `- ${d.summary}`)
    .join('\n');

  return {
    name,
    description,
    nodes,
    edges,
    explanation,
  };
}
