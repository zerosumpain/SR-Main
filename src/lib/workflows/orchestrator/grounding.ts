import type { NodeDefinition } from '../types';

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

  return nodeDefinitions.map((def) => {
    const lines: string[] = [];
    lines.push(`### ${def.label} (\`${def.type}\`)`);
    lines.push(def.description);

    if (def.llmDescription) {
      lines.push(`**Guidance:** ${def.llmDescription}`);
    }

    lines.push(`**Inputs:** ${formatPorts(def.inputs)}`);
    lines.push(`**Outputs:** ${formatPorts(def.outputs)}`);

    const props = def.configSchema?.properties;
    if (props && Object.keys(props).length > 0) {
      const fieldLines = Object.entries(props).map(([key, schema]) => {
        const s = schema as Record<string, unknown>;
        const type = (s.type as string) ?? 'any';
        const desc = s.description ? ` — ${s.description}` : '';
        return `  - \`${key}\` (${type})${desc}`;
      });
      lines.push(`**Config fields:**\n${fieldLines.join('\n')}`);
    }

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
