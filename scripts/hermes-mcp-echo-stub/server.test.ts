import { describe, it, expect } from 'vitest';
import { handleToolCall, listTools } from './server';

describe('echo-stub MCP server', () => {
  it('lists exactly one tool: echo_tool', async () => {
    const tools = await listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('echo_tool');
  });

  it('echoes the message back', async () => {
    const result = await handleToolCall('echo_tool', {
      message: 'hello hermes',
      bridgeToken: 'irrelevant-for-stub',
    });
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'hello hermes' });
  });

  it('rejects unknown tool names', async () => {
    await expect(handleToolCall('nope', {})).rejects.toThrow(/unknown tool/i);
  });
});
