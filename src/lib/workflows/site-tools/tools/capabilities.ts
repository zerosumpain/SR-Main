import { createHash } from 'node:crypto';
import { register } from '../registry-internal';

/**
 * A safe, runtime-derived catalogue for bridge clients. Credential readiness is
 * deliberately expressed as handles only; tool definitions never contain a
 * credential value and this endpoint must remain true even if one is added.
 */
register({
  name: 'capabilities_snapshot',
  description:
    'Return the effective production tool catalogue, including bridge access, safety classification, schema hashes, and known readiness metadata. Never returns credential values.',
  parameters: { type: 'object', properties: {} },
  category: 'System',
  toolset: 'diagnostics',
  handler: async () => {
    const [{ getTools }, { isBridgeable }] = await Promise.all([
      import('../registry'),
      import('$lib/jkai/tool-bridge'),
    ]);
    const environment = process.env.NODE_ENV === 'production' ? 'production' : 'development';
    const tools = getTools().map((tool) => {
      const schema = tool.parameters as Record<string, unknown>;
      const requiredCredentialHandles = Array.isArray(schema['x-requiredCredentialHandles'])
        ? schema['x-requiredCredentialHandles'].filter((handle): handle is string => typeof handle === 'string')
        : [];
      return {
        name: tool.name,
        category: tool.category,
        toolset: tool.toolset,
        access: tool.destructive ? 'destructive' : 'read',
        bridgeable: isBridgeable(tool.name),
        requiredCredentialHandles,
        readiness: requiredCredentialHandles.length > 0 ? 'unknown' : 'not_required',
        environment,
        version: 'registry-v1',
        schemaHash: createHash('sha256').update(JSON.stringify(schema)).digest('hex'),
        deprecated: false,
        replacement: undefined,
        lastHealthCheck: undefined,
      };
    });
    return {
      success: true,
      data: {
        environment,
        catalogue: tools,
        generatedAt: new Date().toISOString(),
      },
    };
  },
});
