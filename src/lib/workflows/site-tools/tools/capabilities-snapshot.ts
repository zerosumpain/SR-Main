import { createHash } from 'node:crypto';
import { register } from '../registry-internal';
import type { ToolDefinition, ToolResult } from '../registry-internal';

export interface CapabilityHealth {
  status: 'healthy' | 'failing' | 'unknown';
  lastErrorAt: string | null;
  lastError: string | null;
}

export interface CapabilitySnapshotEntry {
  name: string;
  category: string;
  toolset: string;
  classification: 'read' | 'write' | 'destructive';
  bridgeable: boolean;
  requiredCredentialHandles: string[];
  credentialReadiness: Array<{ handle: string; available: boolean }>;
  environmentTarget: string;
  version: string;
  schemaHash: string;
  deprecation: { deprecated: boolean; replacement: string | null };
  lastHealthCheck: CapabilityHealth;
}

const WRITE_NAME = /(?:^|_)(?:create|save|update|modify|register|publish|build|start|schedule|pause|resume|clear|forget|amend|set|add|remove|test)(?:_|$)/;

function classification(tool: ToolDefinition): CapabilitySnapshotEntry['classification'] {
  if (tool.destructive) return 'destructive';
  return WRITE_NAME.test(tool.name) ? 'write' : 'read';
}

function schemaHash(parameters: ToolDefinition['parameters']): string {
  return createHash('sha256').update(JSON.stringify(parameters)).digest('hex');
}

/**
 * Shape the registry's currently loaded tools into an auditable catalogue. The
 * registry has no per-tool credential declaration yet, so credential arrays are
 * intentionally empty unless a future tool registration supplies that metadata.
 * This is safer than guessing from descriptions, and never exposes a value.
 */
export function capabilitiesSnapshot(
  tools: readonly ToolDefinition[],
  options: {
    environmentTarget?: string;
    version?: string;
    health?: Map<string, Omit<CapabilityHealth, 'status'>>;
  } = {},
): CapabilitySnapshotEntry[] {
  const environmentTarget = options.environmentTarget ?? (process.env.NODE_ENV === 'production' ? 'production' : 'non-production');
  const version = options.version ?? process.env.GIT_SHA ?? process.env.npm_package_version ?? 'unknown';

  return tools.map((tool) => {
    const health = options.health?.get(tool.name);
    return {
      name: tool.name,
      category: tool.category,
      toolset: tool.toolset,
      classification: classification(tool),
      // Builds use the same destructive flag as the registry's confirmation gate.
      bridgeable: !tool.destructive,
      requiredCredentialHandles: [],
      credentialReadiness: [],
      environmentTarget,
      version,
      schemaHash: schemaHash(tool.parameters),
      deprecation: { deprecated: false, replacement: null },
      lastHealthCheck: health
        ? { status: health.lastErrorAt ? 'failing' : 'healthy', ...health }
        : { status: 'unknown', lastErrorAt: null, lastError: null },
    };
  });
}

async function snapshot(): Promise<ToolResult> {
  const { getTools } = await import('../registry');
  const health = new Map<string, Omit<CapabilityHealth, 'status'>>();
  try {
    const { getToolErrorRates } = await import('$lib/server/tool-error-rates');
    for (const row of (await getToolErrorRates()).tools) {
      health.set(row.tool, { lastErrorAt: row.lastErrorAt, lastError: row.lastError });
    }
  } catch {
    // Health telemetry is optional: an unavailable trace store must not hide
    // the catalogue itself.
  }

  return {
    success: true,
    data: {
      generatedAt: new Date().toISOString(),
      tools: capabilitiesSnapshot(getTools(), { health }),
      credentialNote: 'Credential values are never included; required handles/readiness appear only where declared by a tool.',
    },
  };
}

register({
  name: 'capabilities_snapshot',
  description:
    'Return the effective site-tool catalogue with classification, build bridgeability, schema hashes, environment/version, deprecation metadata, and available health status. Credential values are never returned.',
  parameters: { type: 'object', properties: {} },
  category: 'System Diagnostics',
  toolset: 'diagnostics',
  handler: snapshot,
});
