import type { NodeSpec } from '../spec/types';

/**
 * Idempotently inserts an import and a specialized-map entry for the given
 * spec into a panels/registry.ts source string.
 *
 * Pure function — does not touch the filesystem.
 */
export function patchPanelRegistry(source: string, spec: NodeSpec): string {
  const componentName = pascalCase(spec.type) + 'Panel';
  const importLine = `import ${componentName} from './${componentName}.svelte';`;
  const entryLine = `  '${spec.type}': ${componentName} as unknown as Component<PanelProps>,`;

  let out = source;

  // 1. Add the import after the last existing './XPanel.svelte' import (idempotent).
  if (!out.includes(importLine)) {
    const panelImportRe = /^import \w+Panel from '\.\/\w+Panel\.svelte';$/gm;
    const matches = [...out.matchAll(panelImportRe)];
    if (matches.length > 0) {
      const last = matches[matches.length - 1];
      const insertAt = last.index! + last[0].length;
      out = out.slice(0, insertAt) + '\n' + importLine + out.slice(insertAt);
    } else {
      // Fallback: insert after the first 'import type { Component }' line.
      out = out.replace(
        /^(import type \{ Component \}.*)/m,
        `$1\n${importLine}`,
      );
    }
  }

  // 2. Add the specialized-map entry before the closing brace (idempotent).
  const entryPresent = new RegExp(`'${spec.type}'\\s*:\\s*${componentName}`).test(out);
  if (!entryPresent) {
    out = out.replace(
      /^(const specialized: Record<string, Component<PanelProps>> = \{)([\s\S]*?)^(\};)/m,
      (_, open, body, close) => `${open}${body}${entryLine}\n${close}`,
    );
  }

  return out;
}

function pascalCase(kebab: string): string {
  return kebab
    .split('-')
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join('');
}
