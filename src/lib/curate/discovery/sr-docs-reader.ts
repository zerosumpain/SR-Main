// src/lib/curate/discovery/sr-docs-reader.ts
//
// Reader for the internal sr-docs corpus.
// Reads from ~/sr-docs/content/internal/features/workflows/ — the canonical
// internal documentation for the workflow engine and its nodes.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── Types ────────────────────────────────────────────────────────────────

export interface SrDocsEntry {
  path: string;
  content: string;
}

// ── Constants ────────────────────────────────────────────────────────────

const WORKFLOWS_DOCS_DIR = path.join(
  os.homedir(),
  'sr-docs',
  'content',
  'internal',
  'features',
  'workflows',
);

// ── srDocsRead ────────────────────────────────────────────────────────────

/**
 * Read one or more files from the sr-docs workflows corpus.
 *
 * `globOrPath` may be:
 * - A bare filename: `"engine-and-runtime.md"` — reads that single file.
 * - A glob suffix: `"nodes-*.md"` — reads all matching files.
 * - `"*"` or `""` — reads every file in the directory.
 *
 * Returns an array of `{ path, content }` objects. Returns [] if the
 * sr-docs directory does not exist (non-fatal — discovery continues).
 */
export async function srDocsRead(globOrPath: string): Promise<SrDocsEntry[]> {
  if (!fs.existsSync(WORKFLOWS_DOCS_DIR)) return [];

  const entries = fs.readdirSync(WORKFLOWS_DOCS_DIR).filter((f) => f.endsWith('.md'));

  const pattern = (globOrPath ?? '').trim();

  let selected: string[];

  if (pattern === '' || pattern === '*') {
    selected = entries;
  } else if (pattern.includes('*')) {
    // Simple glob: convert the glob pattern to a regex.
    // Escape special regex chars except *, then replace * with .*
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const re = new RegExp(`^${escaped}$`);
    selected = entries.filter((f) => re.test(f));
  } else {
    // Exact filename.
    selected = entries.includes(pattern) ? [pattern] : [];
  }

  return selected.map((filename) => ({
    path: path.join(WORKFLOWS_DOCS_DIR, filename),
    content: fs.readFileSync(path.join(WORKFLOWS_DOCS_DIR, filename), 'utf8'),
  }));
}
