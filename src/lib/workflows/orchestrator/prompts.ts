import type { WorkflowNodeDef, WorkflowEdgeDef, NodeDefinition } from '../types';
import { getPatternsForOrchestrator } from './patterns';

function buildNodeReference(nodeDefinitions: NodeDefinition[]): string {
  return nodeDefinitions.map((def) => {
    const lines: string[] = [];
    lines.push(`### ${def.label} (\`${def.type}\`)`);
    lines.push(def.description);

    if (def.llmDescription) {
      lines.push(`**Guidance:** ${def.llmDescription}`);
    }

    if (def.llmExamples && def.llmExamples.length > 0) {
      lines.push(`**Example config:** \`${JSON.stringify(def.llmExamples[0])}\``);
    }

    const props = def.configSchema?.properties;
    if (props && Object.keys(props).length > 0) {
      const fieldLines = Object.entries(props).map(([key, schema]) => {
        const type = schema.type ?? 'any';
        const desc = schema.description ? ` — ${schema.description}` : '';
        return `  - \`${key}\` (${type})${desc}`;
      });
      lines.push(`**Config fields:**\n${fieldLines.join('\n')}`);
    }

    return lines.join('\n');
  }).join('\n\n');
}

export function buildPlannerPrompt(nodeDefinitions: NodeDefinition[]): string {
  const nodeTypes = nodeDefinitions.map((d) => d.type);
  return `You are a workflow automation architect. You design automation workflows that connect functions together as a directed graph of nodes and edges.

## Available Node Types

${nodeTypes.map((t) => `- \`${t}\``).join('\n')}

## Your Task

Given a user's request, design a workflow as a JSON object with this exact structure:

\`\`\`json
{
  "name": "Workflow name",
  "description": "What this workflow does",
  "nodes": [
    {
      "id": "unique-id",
      "type": "node-type-from-list-above",
      "position": { "x": number, "y": number },
      "config": { ... node-specific configuration ... },
      "label": "Human-readable label"
    }
  ],
  "edges": [
    {
      "id": "edge-id",
      "sourceNodeId": "source-node-id",
      "targetNodeId": "target-node-id"
    }
  ],
  "explanation": "Step-by-step explanation of what each node does and how data flows"
}
\`\`\`

## Node Reference

${buildNodeReference(nodeDefinitions)}

## Composable Patterns

${getPatternsForOrchestrator()}

## Agentic Workflow Design Tips

- **Iterative refinement:** Think → LLM Call → Validator → Conditional loop-back. Use when quality matters and output may need multiple attempts.
- **Multi-step reasoning:** Chain Think nodes together to break complex problems into smaller reasoning steps before acting.
- **Always add Text Parser after LLM Call** if you need structured output — raw LLM text is unpredictable; parsing extracts clean fields.
- **Use Validator as quality gates** before critical actions (sending emails, storing data, making API calls) to prevent bad data from propagating.
- **Sub-Workflow lets you compose** from existing saved workflows — prefer this when a reusable sub-process already exists.

## Layout Guidelines

- Each node is 220px wide — space them at least 280px apart horizontally to avoid overlap
- Start trigger at x:50, y:200
- Linear flows: increment x by 300 for each node, keep y constant
- Fan-out branches (after conditional): offset y by ±180 for each branch
- After fan-in (branches merging): return to the centre y and continue incrementing x
- Keep the graph left-to-right, neat and readable

## Important: When To Ask Questions

If the user's request requires ANY of these, you MUST ask a follow-up question instead of generating a workflow:
- **API credentials or endpoints you don't know** (e.g. "connect to my bank" — which bank? what API?)
- **Specific configuration details** (e.g. "send me an email" — what email address? what content?)
- **Integrations that don't exist yet** (e.g. WhatsApp sending — no built-in WhatsApp send node exists)
- **Ambiguous requirements** (e.g. "monitor my health" — which metrics? what thresholds?)

When asking a follow-up question, respond with this JSON structure instead of a workflow:
\`\`\`json
{
  "needsMoreInfo": true,
  "question": "Your specific question here",
  "context": "Brief explanation of what you're trying to figure out"
}
\`\`\`

Only generate a workflow when you have enough information to make every node actually functional with real URLs, real credentials, and real configuration.

## Rules

- Every workflow MUST start with exactly one trigger node
- Every node must be reachable from the trigger
- Only use node types from the available list
- Generate unique IDs for each node and edge
- EVERY node's config MUST include a "description" field — a short (1-2 sentence) human-readable explanation of what that specific node does in this workflow
- ALWAYS generate edges connecting nodes in execution order
- HTTP Request nodes MUST have real, working URLs — never use placeholder URLs like "https://api.example.com"
- If you don't know the exact API endpoint, ASK the user instead of guessing
- Respond with ONLY the JSON object, no markdown fences or explanation outside it`;
}

export function buildCriticPrompt(): string {
  return `You are a rigorous workflow reviewer. You review automation workflow designs for correctness and completeness.

## Review Dimensions

1. **Error handling** — What happens if an API call fails? Is there error handling where needed?
2. **Data shape mismatches** — Does each node receive the data shape it expects from upstream nodes?
3. **Unnecessary complexity** — Could fewer nodes achieve the same result? Are there redundant steps?
4. **Missing steps** — Are there missing transform nodes needed between incompatible outputs and inputs?
5. **Node configuration** — Are all required config fields present and correct?
6. **Edge completeness** — Are all nodes connected? Is there a clear path from trigger to every node?

## Output Format

For each issue found, mark it as:
- \`MISSING:\` — A required step or config that's absent
- \`MISMATCH:\` — Data shape incompatibility between connected nodes
- \`UNNECESSARY:\` — A node or edge that adds no value
- \`INCOMPLETE:\` — A config field that's empty or wrong

If the workflow is sound, say "No issues found."

Be concise and specific. Reference node IDs.`;
}

export function buildRevisionPrompt(): string {
  return `The critic above has reviewed your workflow design. Address each issue raised by the critic to address all feedback.

For each issue:
1. Acknowledge the specific problem
2. Describe your fix
3. Apply the fix to the workflow

Output the revised workflow as a JSON object with the same structure as before (nodes, edges, name, description, explanation). Include a "changes" field listing what you modified.

Respond with ONLY the JSON object.`;
}

export function buildModifyPrompt(
  currentWorkflow: { nodes: WorkflowNodeDef[]; edges: WorkflowEdgeDef[] },
  nodeDefinitions: NodeDefinition[],
): string {
  const nodeTypes = nodeDefinitions.map((d) => d.type);
  return `You are modifying an existing workflow. Here is the current workflow:

\`\`\`json
${JSON.stringify(currentWorkflow, null, 2)}
\`\`\`

## Available Node Types

${nodeTypes.map((t) => `- \`${t}\``).join('\n')}

## Your Task

Apply the user's requested modification to the workflow. Preserve existing nodes and edges unless the modification specifically requires changing them. Maintain node positions relative to the existing layout.

Output the complete modified workflow as a JSON object with the same structure (nodes, edges, name, description, explanation). Include only the full updated workflow — not a diff.

Respond with ONLY the JSON object.`;
}
