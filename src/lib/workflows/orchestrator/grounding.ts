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
