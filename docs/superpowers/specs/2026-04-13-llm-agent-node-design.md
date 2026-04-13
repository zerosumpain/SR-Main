# LLM Agent Node — Design Spec

## Goal

Add an LLM Agent node to the workflow engine that runs a multi-turn tool-use loop. Connected downstream nodes become the agent's tools. The agent calls an LLM, the LLM decides which tools to use, the agent executes them, feeds results back, and loops until done or a guardrail triggers.

## Architecture

The LLM Agent is a **self-contained executor** — no engine execution model changes. From the engine's perspective, it's one node that takes a while to execute. Internally it runs a loop:

1. Discover tools by inspecting outgoing edges and looking up connected node definitions
2. Build OpenAI-format `tools` array from those nodes' schemas, configs, and labels
3. Call the LLM with system prompt + user prompt + tool definitions
4. If the LLM returns tool calls, execute the corresponding downstream node executors directly via the registry
5. Feed tool results back to the LLM as tool-result messages
6. Repeat until the LLM responds without tool calls, or a guardrail triggers
7. Output the final response + full tool call history

### Key Decisions

- **No engine changes to execution logic.** The agent calls downstream executors directly. The engine sees one node.
- **Tools = connected nodes.** Each outgoing edge from the agent maps to one tool. The target node's type, label, config, and input schema define the tool.
- **ExecutionContext extension.** Three new fields: `getOutgoingEdges(nodeId)`, `getNodeConfig(nodeId)`, and `registry` reference. These are passed through by the engine when building context — no execution flow changes.
- **Event emission.** The agent emits `node_started`/`node_completed` events for each internal tool execution so the canvas UI shows tool activity in real-time.
- **Conversation state.** The full OpenAI-format message array is maintained across iterations and included in the output for downstream inspection.

## Node Definition

### Config Schema

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | `openai/gpt-4o` | OpenRouter model ID |
| `systemPrompt` | string | `''` | System prompt. Supports `{{input.field}}` templates. |
| `userPrompt` | string | `''` | Initial user prompt. Supports templates. |
| `temperature` | number | `0.7` | Sampling temperature |
| `maxTokens` | number | `4096` | Per-call max tokens |
| `maxIterations` | number | `10` | Hard cap on tool-call rounds |
| `maxTotalTokens` | number | `0` | Cumulative token budget (0 = unlimited) |
| `timeoutMs` | number | `0` | Wall-clock timeout in ms (0 = unlimited) |
| `toolOverrides` | string | `'{}'` | JSON map: `{ [nodeId]: { name?: string, description?: string } }` |

### Output Schema

| Field | Type | Description |
|-------|------|-------------|
| `response` | string | Final LLM response text |
| `toolCallHistory` | array | `[{ tool, input, output, durationMs }]` for each tool execution |
| `iterationCount` | number | How many LLM rounds occurred |
| `stopReason` | string | `'complete'` \| `'max_iterations'` \| `'max_tokens'` \| `'timeout'` |
| `tokensUsed` | object | `{ prompt, completion, total }` cumulative |
| `conversationHistory` | array | Full OpenAI-format message array |

### Ports

- **Input:** `input` (any) — data available for template interpolation and passed to the LLM as context
- **Outputs:** Dynamic — one per connected downstream tool node. The agent uses `_selectedHandle` to NOT route data downstream after execution (tools are called internally, not via normal DAG flow). A final `output` handle carries the agent's result to the next non-tool node.

### Category

`agentic`

### Basic Config

| Field | Type | Control |
|-------|------|---------|
| `model` | dropdown | GPT-4o, Claude Sonnet, GPT-4o Mini, etc. |
| `systemPrompt` | template-textarea | With variable autocomplete |
| `userPrompt` | template-textarea | With variable autocomplete |
| `temperature` | slider | 0–2 |
| `maxIterations` | number | Default 10 |
| `maxTokens` | number | advancedOnly |
| `maxTotalTokens` | number | advancedOnly |
| `timeoutMs` | number | advancedOnly |
| `toolOverrides` | textarea | advancedOnly |

## Tool Discovery

When the agent executor starts:

1. Call `context.getOutgoingEdges(agentNodeId)` to get all outgoing edges
2. For each edge, call `context.getNodeConfig(edge.targetNodeId)` to get the target node's type, config, and label
3. Look up the node definition via `context.registry.getDefinition(type)` for the input schema and description
4. Check `config.toolOverrides` for name/description overrides keyed by `edge.targetNodeId`
5. Build an OpenAI-format tool definition:

```typescript
{
  type: 'function',
  function: {
    name: override?.name || sanitize(label),  // alphanumeric + underscores
    description: override?.description || definition.description,
    parameters: definition.getInputSchema?.(nodeConfig) || { type: 'object' },
  },
}
```

6. Maintain a map of `toolName → { nodeType, nodeConfig, executorType }` for execution dispatch

## Execution Loop

```
build tool definitions from connected nodes
toolMap = { toolName → { executor, config } }
messages = [
  { role: 'system', content: interpolate(systemPrompt, input) },
  { role: 'user', content: interpolate(userPrompt, input) + '\n\nInput data:\n' + JSON.stringify(input) },
]
totalTokens = { prompt: 0, completion: 0 }
toolCallHistory = []
startTime = Date.now()

for iteration in 0..maxIterations-1:
  // Check timeout
  if timeoutMs > 0 && Date.now() - startTime > timeoutMs:
    return { stopReason: 'timeout', ... }

  // Check token budget
  if maxTotalTokens > 0 && totalTokens.prompt + totalTokens.completion >= maxTotalTokens:
    return { stopReason: 'max_tokens', ... }

  // Call LLM
  response = await openrouter.chat.completions.create({
    model, messages, tools: toolDefinitions, temperature, max_tokens: maxTokens,
  })
  totalTokens.prompt += response.usage.prompt_tokens
  totalTokens.completion += response.usage.completion_tokens

  assistantMessage = response.choices[0].message
  messages.push(assistantMessage)

  // Check if LLM is done (no tool calls)
  if !assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0:
    return { stopReason: 'complete', response: assistantMessage.content, ... }

  // Execute each tool call
  for each toolCall in assistantMessage.tool_calls:
    toolInfo = toolMap[toolCall.function.name]
    args = JSON.parse(toolCall.function.arguments)

    emit('node_started', toolInfo.targetNodeId)
    startMs = Date.now()

    result = await toolInfo.executor.execute(args, toolInfo.config, context)

    durationMs = Date.now() - startMs
    emit('node_completed', toolInfo.targetNodeId, result.output)

    toolCallHistory.push({ tool: toolCall.function.name, input: args, output: result.output, durationMs })
    messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result.output) })

// Fell through — max iterations reached
return { stopReason: 'max_iterations', response: lastAssistantContent, ... }
```

## ExecutionContext Changes

Add three new fields to `ExecutionContext` in `types.ts`:

```typescript
export interface ExecutionContext {
  // ... existing fields ...
  getOutgoingEdges: (nodeId: string) => WorkflowEdgeDef[];
  getNodeConfig: (nodeId: string) => { type: string; config: Record<string, unknown>; label: string } | undefined;
  registry: NodeRegistry;
}
```

Update `engine.ts` to populate these when building the context object:

- `getOutgoingEdges`: return `graph.edgesBySource.get(nodeId) || []`
- `getNodeConfig`: return `graph.nodeMap.get(nodeId)` mapped to `{ type, config, label }`
- `registry`: pass `this.registry`

These are read-only lookups. No execution logic changes.

## Edge Handling

The agent node must NOT pass data downstream through its tool edges via normal DAG flow. When the engine processes the agent's output, tool nodes should be skipped (the agent already executed them internally).

Approach: the agent sets `metadata._skipDownstream: true` for tool edges. The engine checks this flag and skips scheduling those target nodes. Alternatively, the agent can set `_selectedHandle: 'output'` so only the `output` handle flows downstream, and tool handles are blocked.

**Recommended:** Use `_selectedHandle: 'output'`. This uses the existing conditional routing mechanism — no engine changes needed. Tool nodes connected to other handles are automatically skipped by the existing `markSkipped` logic.

## Canvas Component

The `LlmAgentNode.svelte` component shows:
- Model badge (like LlmCallNode)
- Tool count: "N tools" derived from connected edges
- Truncated system prompt
- During execution: animated pulse + iteration counter

One **target** handle (left, id: `input`). Two types of **source** handles (right):
- `output` handle — carries the agent's final result downstream
- Tool handles — one per connected tool node (dynamic, labeled with tool name)

## LLM Orchestrator Metadata

```typescript
llmDescription: 'Use this node for complex tasks requiring multiple steps, tool use, and iterative reasoning. The agent autonomously decides which tools to call and in what order. Connected downstream nodes become the agent\'s tools. More powerful than a single LLM Call but more expensive — use when the task genuinely needs multi-step reasoning with tool access.',

llmExamples: [
  {
    model: 'openai/gpt-4o',
    systemPrompt: 'You are a research assistant. Use the available tools to gather information and synthesize a report.',
    userPrompt: 'Research {{input.topic}} and produce a summary with sources.',
    maxIterations: 8,
    temperature: 0.5,
  },
]
```

## Testing Strategy

- Mock `getOpenRouterClient` to control LLM responses
- Test: single-turn (LLM responds without tool calls immediately)
- Test: multi-turn (LLM calls a tool, gets result, then responds)
- Test: max iterations guardrail triggers
- Test: tool execution failure (downstream executor throws)
- Test: tool discovery from outgoing edges
- Test: tool override names/descriptions
- Test: `_selectedHandle: 'output'` prevents downstream tool node execution by engine
