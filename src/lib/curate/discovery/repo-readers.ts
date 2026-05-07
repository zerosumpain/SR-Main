// src/lib/curate/discovery/repo-readers.ts
//
// File-system readers for the curate discovery toolkit.
// All paths are resolved relative to the project root (found by walking up
// from process.cwd() until package.json is found — same pattern as worktree.ts).

import fs from 'node:fs';
import path from 'node:path';

// ── Project root resolution ───────────────────────────────────────────────

/** Walk up from process.cwd() until package.json is found. */
function projectRoot(): string {
  let dir = process.cwd();
  while (dir !== '/') {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Could not locate project root (no package.json found)');
}

// ── readNode ──────────────────────────────────────────────────────────────

export interface NodeSources {
  defSource: string;
  executorSource: string;
}

/**
 * Read an existing workflow node's definition (.def.ts) and executor (.ts).
 * Returns null if either file does not exist.
 *
 * Example: readNode('gmail-fetch') reads
 *   src/lib/workflows/nodes/gmail-fetch.def.ts
 *   src/lib/workflows/nodes/gmail-fetch.ts
 */
export async function readNode(type: string): Promise<NodeSources | null> {
  const root = projectRoot();
  const nodesDir = path.join(root, 'src', 'lib', 'workflows', 'nodes');
  const defPath = path.join(nodesDir, `${type}.def.ts`);
  const execPath = path.join(nodesDir, `${type}.ts`);

  if (!fs.existsSync(defPath) || !fs.existsSync(execPath)) return null;

  const defSource = fs.readFileSync(defPath, 'utf8');
  const executorSource = fs.readFileSync(execPath, 'utf8');
  return { defSource, executorSource };
}

// ── readPanel ─────────────────────────────────────────────────────────────

/**
 * Read a panel Svelte component by name.
 * Returns null if the file does not exist.
 *
 * Example: readPanel('GmailFetchPanel') reads
 *   src/lib/canvas/nodes/panels/GmailFetchPanel.svelte
 */
export async function readPanel(componentName: string): Promise<string | null> {
  const root = projectRoot();
  const panelPath = path.join(
    root,
    'src',
    'lib',
    'canvas',
    'nodes',
    'panels',
    `${componentName}.svelte`,
  );

  if (!fs.existsSync(panelPath)) return null;
  return fs.readFileSync(panelPath, 'utf8');
}

// ── readPackageJson ───────────────────────────────────────────────────────

export interface PackageJsonDeps {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

/**
 * Parse the project's package.json and return dependencies + devDependencies.
 */
export async function readPackageJson(): Promise<PackageJsonDeps> {
  const root = projectRoot();
  const raw = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  const pkg = JSON.parse(raw) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  return {
    dependencies: pkg.dependencies ?? {},
    devDependencies: pkg.devDependencies ?? {},
  };
}

// ── listAvailableNodes ────────────────────────────────────────────────────

/**
 * List all node type names by scanning src/lib/workflows/nodes/ for *.ts
 * files (excluding .def.ts files so each type appears only once).
 */
export async function listAvailableNodes(): Promise<string[]> {
  const root = projectRoot();
  const nodesDir = path.join(root, 'src', 'lib', 'workflows', 'nodes');

  const entries = fs.readdirSync(nodesDir);
  return entries
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.def.ts') && !f.endsWith('.test.ts'))
    .map((f) => f.replace(/\.ts$/, ''))
    .sort();
}
