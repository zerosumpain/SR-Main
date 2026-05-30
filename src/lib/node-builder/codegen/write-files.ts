import fs from 'node:fs';
import path from 'node:path';
import type { NodeSpec } from '../spec/types';
import { emitDefinition } from './definition';
import { emitExecutor } from './executor';
import { emitPanel } from './panel';
import { emitDocs } from './docs';
import { patchPanelRegistry } from './registry-patch';
import { patchWorkflowsIndex } from './index-patch';
import { emitAdapter, adapterFileName } from './adapter';
import { patchAdapterIndex } from './adapter-index-patch';
import { validateNodeSpec } from '../spec/validate';

export interface WriteResult {
  /** Paths written, relative to process.cwd() (except the sr-docs path). */
  written: string[];
}

/**
 * Runs all emitters for the given spec and writes the results to disk.
 *
 * - New files (def, executor, panel) are always written (overwritten on
 *   subsequent calls — content is deterministic so idempotent in practice).
 * - Existing files (registry, index) are patched idempotently.
 * - The sr-docs markdown is written to srDocsDir.
 *
 * Throws if the spec fails structural validation.
 */
export async function writeNodeFiles(
  spec: NodeSpec,
  srDocsDir: string,
): Promise<WriteResult> {
  const worktreeDir = process.cwd();
  const validation = validateNodeSpec(spec);
  if (!validation.ok) {
    throw new Error(`Invalid NodeSpec: ${validation.errors.join('; ')}`);
  }

  const written: string[] = [];

  // 1. Definition file.
  const defRelPath = path.join('src/lib/workflows/nodes', `${spec.type}.def.ts`);
  writeFile(worktreeDir, defRelPath, emitDefinition(spec));
  written.push(defRelPath);

  // 2. Executor file.
  const execRelPath = path.join('src/lib/workflows/nodes', `${spec.type}.ts`);
  writeFile(worktreeDir, execRelPath, emitExecutor(spec));
  written.push(execRelPath);

  // 3. Specialized panel file.
  const componentName = pascalCase(spec.type) + 'Panel';
  const panelRelPath = path.join('src/lib/canvas/nodes/panels', `${componentName}.svelte`);
  writeFile(worktreeDir, panelRelPath, emitPanel(spec));
  written.push(panelRelPath);

  // 4. Patch panels/registry.ts (idempotent).
  const registryRelPath = path.join('src/lib/canvas/nodes/panels', 'registry.ts');
  const registryFull = path.join(worktreeDir, registryRelPath);
  const registrySource = fs.readFileSync(registryFull, 'utf8');
  fs.writeFileSync(registryFull, patchPanelRegistry(registrySource, spec), 'utf8');
  written.push(registryRelPath);

  // 5. Patch workflows/index.ts (idempotent).
  const indexRelPath = path.join('src/lib/workflows', 'index.ts');
  const indexFull = path.join(worktreeDir, indexRelPath);
  const indexSource = fs.readFileSync(indexFull, 'utf8');
  fs.writeFileSync(indexFull, patchWorkflowsIndex(indexSource, spec), 'utf8');
  written.push(indexRelPath);

  // 6. Integration adapter (only if spec declares an integrationType).
  const adapterSource = emitAdapter(spec);
  if (adapterSource && spec.integrationType) {
    const adapterRelPath = path.join(
      'src/lib/integrations/adapters',
      adapterFileName(spec.integrationType),
    );
    writeFile(worktreeDir, adapterRelPath, adapterSource);
    written.push(adapterRelPath);

    // 6a. Patch adapter index barrel (creates it if missing).
    const adapterIndexRelPath = path.join(
      'src/lib/integrations/adapters',
      'index.ts',
    );
    const adapterIndexFull = path.join(worktreeDir, adapterIndexRelPath);
    const adapterIndexSource = fs.existsSync(adapterIndexFull)
      ? fs.readFileSync(adapterIndexFull, 'utf8')
      : '';
    fs.mkdirSync(path.dirname(adapterIndexFull), { recursive: true });
    fs.writeFileSync(
      adapterIndexFull,
      patchAdapterIndex(adapterIndexSource, spec),
      'utf8',
    );
    written.push(adapterIndexRelPath);
  }

  // 7. sr-docs entry (written to srDocsDir, not worktreeDir).
  const docsRelPath = path.join(
    'content/internal/features/workflows/nodes',
    `${spec.type}.md`,
  );
  const docsFull = path.join(srDocsDir, docsRelPath);
  fs.mkdirSync(path.dirname(docsFull), { recursive: true });
  fs.writeFileSync(docsFull, emitDocs(spec), 'utf8');
  // Not added to `written` since it's in a different root (srDocsDir).

  return { written };
}

function writeFile(base: string, relPath: string, content: string): void {
  const full = path.join(base, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function pascalCase(kebab: string): string {
  return kebab
    .split('-')
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join('');
}
