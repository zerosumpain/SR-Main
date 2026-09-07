// The Local Plan Navigator's corpus, read from the published bundle.
//
// The bundle's build writes data/corpus.json (about 1,000 passages of the
// 2026 Regulations, the SEA Regulations, the NPPF and the MHCLG guidance)
// next to its pages under data/jkai-projects/local-plan-navigator. The
// endpoint answers from that same file, so the server quotes exactly what the
// page shows, and a redeploy of the bundle is picked up on the next request
// by its mtime — no restart, no second copy of the texts.
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getPublishedDir } from '$lib/jkai/sandbox';
import type { NavigatorChunk } from './ask';

const SLUG = 'local-plan-navigator';
let cache: { mtimeMs: number; byId: Map<string, NavigatorChunk> } | null = null;

export function corpusPath(): string {
  return join(getPublishedDir(), SLUG, 'data', 'corpus.json');
}

export async function loadNavigatorCorpus(): Promise<Map<string, NavigatorChunk>> {
  const path = corpusPath();
  const { mtimeMs } = await stat(path);
  if (cache && cache.mtimeMs === mtimeMs) return cache.byId;
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { chunks: NavigatorChunk[] };
  const byId = new Map<string, NavigatorChunk>();
  for (const c of parsed.chunks) byId.set(c.id, c);
  cache = { mtimeMs, byId };
  return byId;
}
