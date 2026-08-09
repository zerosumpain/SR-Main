import { describe, expect, it } from 'vitest';
import { executeTool, getTool } from '../registry';
import { dispatchMetaTool } from '$lib/mcp/meta-tool';
import { CAPABILITIES_SNAPSHOT } from './capabilities';

describe('capabilities_snapshot', () => {
  it('is a read-only registered site tool with the static capability contract', async () => {
    const tool = getTool('capabilities_snapshot');
    expect(tool?.parameters).toEqual({ type: 'object', properties: {}, required: [] });
    expect(tool?.destructive).toBeFalsy();

    await expect(executeTool('capabilities_snapshot', {})).resolves.toEqual({
      success: true,
      data: CAPABILITIES_SNAPSHOT,
    });

    const extended = await dispatchMetaTool({ operation: 'list' });
    expect(extended).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'capabilities_snapshot' })]),
    );
  });
});
