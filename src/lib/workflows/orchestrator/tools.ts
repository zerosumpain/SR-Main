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

// --- Schema Map ---

export const toolSchemas = {
  search_nodes: searchNodesSchema,
  use_node: useNodeSchema,
  create_node: createNodeSchema,
  connect_nodes: connectNodesSchema,
  ask_user: askUserSchema,
  finalize_workflow: finalizeWorkflowSchema,
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

export const openaiTools: OpenAIFunctionDef[] = [
  zodToFunction('search_nodes', searchNodesSchema, 'Search the node registry for nodes matching a capability. ALWAYS call this before use_node to verify the node exists.'),
  zodToFunction('use_node', useNodeSchema, 'Add an existing node to the workflow. Requires a reason and at least one alternative considered.'),
  zodToFunction('create_node', createNodeSchema, 'Create a new reusable node type for a service integration that does not exist yet. Generates definition + executor code.'),
  zodToFunction('connect_nodes', connectNodesSchema, 'Connect two nodes with an edge. Use sourceHandle/targetHandle for conditional routing.'),
  zodToFunction('ask_user', askUserSchema, 'Ask the user a clarification question before proceeding.'),
  zodToFunction('finalize_workflow', finalizeWorkflowSchema, 'Signal that the workflow design is complete.'),
];
