import type { NodeSpec } from '../spec/types';

/**
 * Idempotently inserts an import and a registry.register() call for the given
 * spec into a workflows/index.ts source string.
 *
 * Pure function — does not touch the filesystem.
 */
export function patchWorkflowsIndex(source: string, spec: NodeSpec): string {
  const camelType = camel(spec.type);
  const importLine = `import { ${camelType}Def, ${camelType}Executor } from './nodes/${spec.type}';`;
  const registerLine = `registry.register(${camelType}Def, ${camelType}Executor);`;

  let out = source;

  // 1. Add the import after the last node import (idempotent).
  if (!out.includes(importLine)) {
    const nodeImportRe = /^import \{[^}]+\} from '\.\/nodes\/[a-z0-9-]+';$/gm;
    const matches = [...out.matchAll(nodeImportRe)];
    if (matches.length > 0) {
      const last = matches[matches.length - 1];
      const insertAt = last.index! + last[0].length;
      out = out.slice(0, insertAt) + '\n' + importLine + out.slice(insertAt);
    } else {
      // Fallback: after `import { NodeRegistry }` line.
      out = out.replace(
        /^(import \{ NodeRegistry \}.*)/m,
        `$1\n${importLine}`,
      );
    }
  }

  // 2. Add the register call after the last registry.register() call (idempotent).
  if (!out.includes(registerLine)) {
    const registerRe = /^registry\.register\([^)]+\);$/gm;
    const matches = [...out.matchAll(registerRe)];
    if (matches.length > 0) {
      const last = matches[matches.length - 1];
      const insertAt = last.index! + last[0].length;
      out = out.slice(0, insertAt) + '\n' + registerLine + out.slice(insertAt);
    } else {
      // Fallback: after `export const registry = ...;`
      out = out.replace(
        /^(export const registry = .*?;)$/m,
        `$1\n\n${registerLine}`,
      );
    }
  }

  return out;
}

function camel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
