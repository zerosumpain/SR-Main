import { describe, expect, it } from 'vitest';
import { capabilitiesSnapshot } from './capabilities-snapshot';
import type { ToolDefinition } from '../registry-internal';

describe('capabilitiesSnapshot', () => {
  it('returns the bridge-safe capability contract without credential values', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'report_read',
        description: 'Read a report',
        category: 'Reports',
        toolset: 'reports',
        parameters: { type: 'object', properties: { id: { type: 'string' } } },
        handler: async () => ({ success: true }),
      },
      {
        name: 'report_delete',
        description: 'Delete a report',
        category: 'Reports',
        toolset: 'reports',
        destructive: true,
        parameters: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      },
    ];

    const [read, destructive] = capabilitiesSnapshot(tools, {
      environmentTarget: 'production',
      version: 'test-sha',
    });

    expect(read).toMatchObject({
      name: 'report_read',
      category: 'Reports',
      toolset: 'reports',
      classification: 'read',
      bridgeable: true,
      requiredCredentialHandles: [],
      credentialReadiness: [],
      environmentTarget: 'production',
      version: 'test-sha',
      deprecation: { deprecated: false, replacement: null },
      lastHealthCheck: { status: 'unknown', lastErrorAt: null, lastError: null },
    });
    expect(read.schemaHash).toMatch(/^[a-f0-9]{64}$/);
    expect(destructive).toMatchObject({ classification: 'destructive', bridgeable: false });
    expect(JSON.stringify([read, destructive])).not.toContain('secret-value');
  });
});
