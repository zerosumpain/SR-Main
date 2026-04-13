import { describe, it, expect } from 'vitest';
import {
  searchNodesSchema,
  useNodeSchema,
  createNodeSchema,
  connectNodesSchema,
  askUserSchema,
  finalizeWorkflowSchema,
  zodToFunction,
} from '$lib/workflows/orchestrator/tools';

describe('tool schemas', () => {
  it('validates a correct search_nodes call', () => {
    const result = searchNodesSchema.safeParse({ query: 'slack messaging' });
    expect(result.success).toBe(true);
  });

  it('rejects search_nodes with empty query', () => {
    const result = searchNodesSchema.safeParse({ query: '' });
    expect(result.success).toBe(false);
  });

  it('validates a correct use_node call', () => {
    const result = useNodeSchema.safeParse({
      nodeType: 'transform',
      config: { expression: 'return input' },
      label: 'Format data',
      reason: 'Need to reshape the API response into the expected format',
      alternativesConsidered: [
        { nodeType: 'code-execute', whyRejected: 'Overkill for simple object mapping' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects use_node with empty reason', () => {
    const result = useNodeSchema.safeParse({
      nodeType: 'transform',
      config: {},
      label: 'Test',
      reason: 'short',
      alternativesConsidered: [{ nodeType: 'x', whyRejected: 'y' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects use_node with no alternatives', () => {
    const result = useNodeSchema.safeParse({
      nodeType: 'transform',
      config: {},
      label: 'Test',
      reason: 'A sufficiently long reason for using this node',
      alternativesConsidered: [],
    });
    expect(result.success).toBe(false);
  });

  it('validates a correct create_node call', () => {
    const result = createNodeSchema.safeParse({
      type: 'slack-send',
      label: 'Slack Send',
      category: 'integration',
      description: 'Send a message to a Slack channel',
      configSchema: {
        type: 'object',
        properties: {
          webhookUrl: { type: 'string', description: 'Slack webhook URL' },
          channel: { type: 'string', description: 'Channel name' },
        },
        required: ['webhookUrl'],
      },
      defaultConfig: { webhookUrl: '', channel: '#general' },
      inputs: [{ name: 'input', type: 'object' }],
      outputs: [{ name: 'output', type: 'object' }],
      executorCode: 'export async function execute(input, config) { return { output: {} }; }',
      reason: 'No existing Slack integration node — creating a reusable one for webhook-based messaging',
    });
    expect(result.success).toBe(true);
  });

  it('validates connect_nodes', () => {
    const result = connectNodesSchema.safeParse({
      sourceId: 'trigger-1',
      targetId: 'slack-1',
    });
    expect(result.success).toBe(true);
  });

  it('validates connect_nodes with handles', () => {
    const result = connectNodesSchema.safeParse({
      sourceId: 'cond-1',
      targetId: 'email-1',
      sourceHandle: 'true',
    });
    expect(result.success).toBe(true);
  });

  it('validates ask_user', () => {
    const result = askUserSchema.safeParse({
      question: 'What Slack workspace should I send to?',
      context: 'I need the webhook URL to configure the Slack node',
    });
    expect(result.success).toBe(true);
  });

  it('validates finalize_workflow', () => {
    const result = finalizeWorkflowSchema.safeParse({
      name: 'Daily Slack Alert',
      description: 'Sends a daily summary to #alerts',
    });
    expect(result.success).toBe(true);
  });
});

describe('zodToFunction', () => {
  it('converts a Zod schema to OpenAI function definition', () => {
    const fn = zodToFunction('search_nodes', searchNodesSchema, 'Search the node registry for nodes matching a capability');
    expect(fn.type).toBe('function');
    expect(fn.function.name).toBe('search_nodes');
    expect(fn.function.description).toBe('Search the node registry for nodes matching a capability');
    expect(fn.function.parameters.type).toBe('object');
    expect(fn.function.parameters.properties.query).toBeDefined();
    expect(fn.function.parameters.required).toContain('query');
  });

  it('handles optional fields correctly', () => {
    const fn = zodToFunction('search_nodes', searchNodesSchema, 'Search');
    expect(fn.function.parameters.required).not.toContain('category');
  });
});
