import type { ToolDefinition } from '$lib/workflows/site-tools/registry-internal';
import { describeWithPolicy, type ToolPolicyVersion } from '$lib/toolpolicy/policy';

/** One ranking contract for native and extended discovery. */
export function resolveCapabilities<T extends Pick<ToolDefinition, 'name' | 'description' | 'toolset'>>(
  tools: readonly T[], query: string, limit = 12,
): T[] {
  const q = query.toLowerCase().trim();
  const words = q.split(/[^a-z0-9_]+/).filter(w => w.length > 1 && !['the', 'my', 'me', 'to', 'an', 'for', 'and', 'of', 'use'].includes(w));
  return tools.map(tool => {
    const name = tool.name.toLowerCase();
    const text = `${name} ${tool.description} ${tool.toolset}`.toLowerCase();
    let score = name === q ? 1000 : name.includes(q) ? 100 : text.includes(q) ? 50 : 0;
    for (const word of words) score += name.includes(word) ? 10 : text.includes(word) ? 3 : 0;
    return { tool, score };
  }).filter(r => !q || r.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, Math.max(1, Math.min(limit, 100))).map(r => r.tool);
}

export function applyCapabilityPolicy<T extends { function: { name: string; description?: string } }>(
  definitions: T[], policy: ToolPolicyVersion,
): T[] {
  return definitions.map(t => ({ ...t, function: { ...t.function,
    description: describeWithPolicy(policy, t.function.name, t.function.description ?? ''),
  } }));
}
