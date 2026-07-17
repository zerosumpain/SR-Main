import type { NodeDefinition, BasicConfigField } from '../types';

export interface ExecutionExample {
  nodeType: string;
  inputData: unknown;
  outputData: unknown;
}

function truncateJson(data: unknown, maxLen: number = 500): string {
  const str = JSON.stringify(data, null, 2);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

function formatPorts(ports: Array<{ name: string; type: string; label?: string }>): string {
  if (!ports || ports.length === 0) return 'none';
  return ports.map(p => {
    const label = p.label ? ` (${p.label})` : '';
    return `${p.name}: ${p.type}${label}`;
  }).join(', ');
}

function describeVisibility(rule: BasicConfigField['visibleWhen']): string | null {
  if (!rule) return null;
  if (rule.equals !== undefined) return `only when ${rule.key}=${JSON.stringify(rule.equals)}`;
  if (rule.in !== undefined) return `only when ${rule.key} in [${(rule.in as unknown[]).map((v) => JSON.stringify(v)).join(', ')}]`;
  if (rule.not !== undefined) return `only when ${rule.key}≠${JSON.stringify(rule.not)}`;
  return null;
}

function buildConfigFieldsSection(def: NodeDefinition): string | null {
  const props = def.configSchema?.properties;
  if (!props || Object.keys(props).length === 0) return null;
  const required = new Set(def.configSchema?.required ?? []);
  const visibilityByKey = new Map<string, string>();
  for (const f of def.basicConfig ?? []) {
    const v = describeVisibility(f.visibleWhen);
    if (v) visibilityByKey.set(f.key, v);
  }

  const defaults = (def.defaultConfig ?? {}) as Record<string, unknown>;
  const lines = Object.entries(props).map(([key, schema]) => {
    const s = schema as Record<string, unknown> & { type?: string; enum?: unknown[]; description?: string };
    const type = s.type ?? 'any';
    const tag = required.has(key) ? ' (required)' : '';
    const enumList = Array.isArray(s.enum) && s.enum.length > 0
      ? ` enum: ${s.enum.map((v) => JSON.stringify(v)).join(' | ')}`
      : '';
    const dflt = key in defaults ? ` default: ${JSON.stringify(defaults[key])}` : '';
    const cond = visibilityByKey.has(key) ? ` (${visibilityByKey.get(key)})` : '';
    const desc = s.description ? ` — ${s.description}` : '';
    return `  - \`${key}\` (${type}${tag}${enumList}${dflt})${cond}${desc}`;
  });
  return `**Config fields:**\n${lines.join('\n')}`;
}

function buildExamplesSection(def: NodeDefinition): string | null {
  if (!def.llmExamples || def.llmExamples.length === 0) return null;
  const lines = def.llmExamples
    .slice(0, 3)
    .map((ex) => `  - ${JSON.stringify(ex)}`);
  return `**Example configs:**\n${lines.join('\n')}`;
}

/**
 * Render the full grounding block for a single node definition, reusing the
 * exact same renderer used for the orchestrator's Node Registry section. Used by
 * the `workflow_describe_node` MCP tool so the agent sees the same detail
 * (config fields with required flags / enums / defaults, input/output ports,
 * usage examples) it would get from the registry — on demand, for one type.
 */
export function buildSingleNodeGrounding(
  def: NodeDefinition,
  recentExecutions: ExecutionExample[] = [],
): string {
  // buildNodeGrounding skips `hidden` nodes (they're omitted from the registry
  // view), but an explicit describe_node lookup should always render — clear the
  // flag so a deliberately-requested hidden type still gets its full detail.
  return buildNodeGrounding([{ ...def, hidden: false }], recentExecutions);
}

/** First sentence (or first ~120 chars) of a tool description, single-line. */
function firstSentence(desc: string): string {
  const clean = desc.replace(/\s+/g, ' ').trim();
  const m = clean.match(/^(.*?[.!?])(\s|$)/);
  const s = m ? m[1] : clean;
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

/**
 * Compact catalog of the site tools reachable via the generic `site-tool` node,
 * grouped by toolset. Denylisted tools (arbitrary-code / self-modification /
 * irreversible-wipe surfaces) are excluded — they can never run from a workflow.
 * Destructive tools are flagged so the planner knows they need `allowDestructive`
 * + an upstream `approval` node.
 *
 * Lazy-imports the registry (server-only domain modules; circular-init hazard).
 * Returns '' when the registry can't be loaded (e.g. client bundle). Kept under
 * ~6KB: falls back to name-only lines if the detailed form would exceed it.
 */
interface CatalogTool { name: string; description: string; toolset: string; destructive?: boolean }

export async function buildSiteToolCatalog(): Promise<string> {
  let getTools: () => ReadonlyArray<CatalogTool>;
  let isDenylistedTool: (name: string) => boolean;
  try {
    ({ getTools } = await import('$lib/workflows/site-tools/registry'));
    ({ isDenylistedTool } = await import('$lib/workflows/nodes/site-tool-denylist'));
  } catch {
    return '';
  }

  const tools: CatalogTool[] = getTools()
    .filter((t) => !isDenylistedTool(t.name))
    .slice()
    .sort((a, b) => a.toolset.localeCompare(b.toolset) || a.name.localeCompare(b.name));
  if (tools.length === 0) return '';

  const byToolset = new Map<string, CatalogTool[]>();
  for (const t of tools) {
    const arr = byToolset.get(t.toolset);
    if (arr) arr.push(t);
    else byToolset.set(t.toolset, [t]);
  }

  const header =
    '## Site tools (via the `site-tool` node)\n' +
    'Any of these can be invoked with a `site-tool` node (set `toolName` + templated `args`). ' +
    'Read-only tools run directly; tools marked **DESTRUCTIVE** require `allowDestructive: true` AND an ' +
    '`approval` node upstream on the same path. Prefer a dedicated node (`file-search`, `research-search`, ' +
    '`deck-build`, blog/gmail nodes) where one exists.';

  const renderDetailed = () => {
    const sections: string[] = [];
    for (const [toolset, list] of byToolset) {
      const lines = list.map((t) => {
        const flag = t.destructive ? ' — **DESTRUCTIVE**' : '';
        return `- \`${t.name}\` — ${firstSentence(t.description)}${flag}`;
      });
      sections.push(`### ${toolset}\n${lines.join('\n')}`);
    }
    return `${header}\n\n${sections.join('\n\n')}`;
  };

  const renderCompact = () => {
    const sections: string[] = [];
    for (const [toolset, list] of byToolset) {
      const names = list.map((t) => `\`${t.name}\`${t.destructive ? '*' : ''}`).join(', ');
      sections.push(`- **${toolset}**: ${names}`);
    }
    return `${header}\n(compact — \`*\` marks DESTRUCTIVE)\n\n${sections.join('\n')}`;
  };

  const MAX_BYTES = 6000;
  const detailed = renderDetailed();
  return Buffer.byteLength(detailed, 'utf8') <= MAX_BYTES ? detailed : renderCompact();
}

export function buildNodeGrounding(
  nodeDefinitions: NodeDefinition[],
  recentExecutions: ExecutionExample[],
): string {
  const executionsByType = new Map<string, ExecutionExample[]>();
  for (const exec of recentExecutions) {
    const existing = executionsByType.get(exec.nodeType) || [];
    if (existing.length < 2) {
      existing.push(exec);
      executionsByType.set(exec.nodeType, existing);
    }
  }

  // Hidden nodes stay registered (so existing canvases keep working) but
  // are deliberately omitted from the orchestrator's view — typically a
  // legacy multi-mode node that's been split into per-operation variants.
  const visible = nodeDefinitions.filter((d) => !d.hidden);

  return visible.map((def) => {
    const lines: string[] = [];
    lines.push(`### ${def.label} (\`${def.type}\`)`);
    lines.push(def.description);

    if (def.llmDescription) {
      lines.push(`**Guidance:** ${def.llmDescription}`);
    }

    lines.push(`**Inputs:** ${formatPorts(def.inputs)}`);
    lines.push(`**Outputs:** ${formatPorts(def.outputs)}`);

    const fieldsSection = buildConfigFieldsSection(def);
    if (fieldsSection) lines.push(fieldsSection);

    const examplesSection = buildExamplesSection(def);
    if (examplesSection) lines.push(examplesSection);

    const executions = executionsByType.get(def.type);
    if (executions && executions.length > 0) {
      const ex = executions[0];
      const inputFields = ex.inputData ? Object.keys(ex.inputData as object) : [];
      const hasRelevantInput = inputFields.length > 0;

      if (hasRelevantInput || ex.outputData) {
        lines.push(`**Real usage example:**`);
        if (hasRelevantInput) {
          lines.push(`  Input: ${truncateJson(ex.inputData, 200)}`);
        }
        if (ex.outputData) {
          lines.push(`  Output: ${truncateJson(ex.outputData, 200)}`);
        }
      }
    }

    return lines.join('\n');
  }).join('\n\n');
}
