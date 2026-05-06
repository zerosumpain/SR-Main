import { z } from 'zod';

// --- Tool Schemas ---

export const searchNodesSchema = z.object({
  query: z.string().min(1, 'Query must not be empty'),
  category: z.enum(['trigger', 'core', 'integration', 'control', 'agentic', 'custom']).optional(),
});

export const useNodeSchema = z.object({
  nodeType: z.string(),
  config: z.object({}).catchall(z.any()),
  label: z.string(),
  reason: z.string().min(10, 'Reason must be at least 10 characters — explain why this node was chosen'),
  alternativesConsidered: z.array(z.object({
    nodeType: z.string(),
    whyRejected: z.string(),
  })).min(1, 'Must consider at least one alternative'),
});

export const createNodeSchema = z.object({
  type: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Type must be lowercase kebab-case'),
  label: z.string(),
  category: z.enum(['integration', 'core', 'control', 'agentic', 'custom']),
  description: z.string().min(10),
  configSchema: z.object({
    type: z.literal('object'),
    properties: z.object({}).catchall(z.any()).optional(),
    required: z.array(z.string()).optional(),
  }).passthrough(),
  defaultConfig: z.object({}).catchall(z.any()),
  inputs: z.array(z.object({ name: z.string(), type: z.string() })),
  outputs: z.array(z.object({ name: z.string(), type: z.string() })),
  executorCode: z.string().min(10, 'Executor code is required'),
  testConfig: z.object({}).catchall(z.any()).optional(),
  reason: z.string().min(10),
});

export const connectNodesSchema = z.object({
  sourceId: z.string(),
  targetId: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});

export const askUserSchema = z.object({
  question: z.string().min(5),
  context: z.string().optional(),
});

export const finalizeWorkflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export const setTriggerSchema = z.object({
  type: z.enum(['manual', 'webhook', 'cron', 'event']),
  config: z.object({}).catchall(z.any()).optional(),
});

export const updateNodeSchema = z.object({
  nodeId: z.string().min(1),
  config: z.object({}).catchall(z.any()),
  reason: z.string().min(10, 'Reason must explain what is being fixed and why'),
});

export const removeNodeSchema = z.object({
  nodeId: z.string().min(1),
  reason: z.string().min(10, 'Reason must explain why this node is unnecessary'),
});

export const verifyWorkflowSchema = z.object({
  initialInput: z.record(z.string(), z.unknown()).optional().describe('Optional input to seed the workflow with'),
});

// --- Schema Map ---

export const toolSchemas = {
  search_nodes: searchNodesSchema,
  use_node: useNodeSchema,
  create_node: createNodeSchema,
  connect_nodes: connectNodesSchema,
  ask_user: askUserSchema,
  finalize_workflow: finalizeWorkflowSchema,
  set_trigger: setTriggerSchema,
  update_node: updateNodeSchema,
  remove_node: removeNodeSchema,
  verify_workflow: verifyWorkflowSchema,
} as const;

export type ToolName = keyof typeof toolSchemas;

// --- Zod → OpenAI Function Converter ---

interface OpenAIFunctionDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

export function zodToFunction(
  name: string,
  schema: z.ZodObject<any>,
  description: string,
): OpenAIFunctionDef {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const zodType = value as z.ZodTypeAny;
    properties[key] = zodToJsonSchema(zodType);
    if (!isOptional(zodType)) {
      required.push(key);
    }
  }

  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required },
    },
  };
}

function isOptional(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodOptional) return true;
  if (schema instanceof z.ZodDefault) return true;
  return false;
}

function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodOptional) return zodToJsonSchema(schema.unwrap());
  if (schema instanceof z.ZodDefault) return zodToJsonSchema(schema.removeDefault());
  if (schema instanceof z.ZodString) return { type: 'string' };
  if (schema instanceof z.ZodNumber) return { type: 'number' };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options };
  if (schema instanceof z.ZodLiteral) return { type: typeof schema.value, const: schema.value };
  if (schema instanceof z.ZodArray) return { type: 'array', items: zodToJsonSchema(schema.element) };
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const props: Record<string, unknown> = {};
    const req: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      props[k] = zodToJsonSchema(v as z.ZodTypeAny);
      if (!isOptional(v as z.ZodTypeAny)) req.push(k);
    }
    const result: Record<string, unknown> = { type: 'object', properties: props };
    if (req.length > 0) result.required = req;
    return result;
  }
  if (schema instanceof z.ZodRecord) return { type: 'object', additionalProperties: true };
  if (schema instanceof z.ZodUnion) return { anyOf: (schema.options as z.ZodTypeAny[]).map(zodToJsonSchema) };
  return { type: 'object' };
}

// --- Build OpenAI tools array ---

export const scraperTargetKnowledgeLookupTool: OpenAIFunctionDef = {
  type: 'function',
  function: {
    name: 'scraper_target_knowledge_lookup',
    description:
      'Look up what we know about one or more domains before planning a scraper workflow. ' +
      'Returns knowledge including whether each domain requires an interactive-step upstream ' +
      '(for CAPTCHAs, login walls, cookie consent), verified CSS selectors, and free-form notes. ' +
      'ALWAYS call this before planning any stealth-scrape node for the given URLs.',
    parameters: {
      type: 'object',
      properties: {
        domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'URLs or hostnames to look up',
        },
      },
      required: ['domains'],
    },
  },
};

export const openaiTools: OpenAIFunctionDef[] = [
  scraperTargetKnowledgeLookupTool,
  zodToFunction('search_nodes', searchNodesSchema, 'Search the node registry for nodes matching a capability. OPTIONAL — the full registry is already in your system prompt, so search is only needed when you are genuinely unsure which canonical type string a node uses.'),
  zodToFunction('use_node', useNodeSchema, 'Add an existing node to the workflow. Requires a reason and at least one alternative considered.'),
  zodToFunction('create_node', createNodeSchema, 'Create a new reusable node type for a service integration that does not exist yet. Generates definition + executor code.'),
  zodToFunction('connect_nodes', connectNodesSchema, 'Connect two nodes with an edge. Use sourceHandle/targetHandle for conditional routing.'),
  zodToFunction('ask_user', askUserSchema, 'Ask the user a clarification question before proceeding.'),
  zodToFunction('finalize_workflow', finalizeWorkflowSchema, 'Signal that the workflow design is complete.'),
  zodToFunction('set_trigger', setTriggerSchema, 'Set the workflow trigger type. Use "manual" for user-initiated runs (this is the default; you can omit this tool call for manual workflows), "webhook" for HTTP-triggered, "cron" for scheduled (provide config.expression as a cron string like "0 9 * * *"), or "event" for event-driven.'),
  zodToFunction('update_node', updateNodeSchema, 'Update an existing node\'s config in the workflow by its ID. Use this to fix config issues (e.g. change a wrong template path, swap an operation, correct a URL). Does NOT change the node type — use create_node for that. Requires a reason explaining what issue is being fixed.'),
  zodToFunction('remove_node', removeNodeSchema, 'Remove a node from the draft by its ID. Use this when the critic flags an UNNECESSARY node — also drops every edge involving the removed node so the graph stays consistent. Requires a reason (≥10 chars) explaining why the node is dispensable. Use sparingly — prefer not adding the node in the first place.'),
  zodToFunction(
    'verify_workflow',
    verifyWorkflowSchema,
    'Run the current workflow draft in dry-run mode (side-effecting nodes simulated, capture log returned). Use BEFORE finalize_workflow when the workflow contains any side-effecting nodes (whatsapp, email, gmail-send, gmail-reply, gmail-label, blog, home-assistant, data-store, intel-write). Review the captureLog against the user\'s original goal — if it does not satisfy the goal, call update_node to fix and verify again. You may call verify_workflow at most 3 times per draft.',
  ),
];
