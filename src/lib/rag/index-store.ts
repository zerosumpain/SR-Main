// Persistence for a collection's vector index. Serialized as NDJSON (one chunk
// record per line) and stored via the shared file-store seam, which transparently
// dispatches to Azure Blob when AZURE_STORAGE_CONNECTION_STRING is set (the
// already-provisioned Cool/LRS 'drive' container, under a `rag-index/` prefix)
// and to local fs otherwise. This is the "lightweight, low-cost, persistent
// Azure service" for the index — no new infra, dimension-agnostic.

import { join } from 'node:path';
import { saveBuffer, readBuffer, deleteFile, storeRoot } from '$lib/file-store/storage';
import type { RagChunk } from './types';

/** Blob/disk key for a collection's index (posix-relative form is the blob name). */
export function indexBlobKey(collectionId: string): string {
  return `rag-index/${collectionId}.ndjson`;
}

function indexPath(collectionId: string): string {
  return join(storeRoot(), 'rag-index', `${collectionId}.ndjson`);
}

export async function saveIndex(collectionId: string, chunks: RagChunk[]): Promise<string> {
  const ndjson = chunks.map((c) => JSON.stringify(c)).join('\n');
  await saveBuffer(indexPath(collectionId), Buffer.from(ndjson, 'utf-8'));
  return indexBlobKey(collectionId);
}

export async function readIndex(collectionId: string): Promise<RagChunk[]> {
  const buf = await readBuffer(indexPath(collectionId));
  const text = buf.toString('utf-8');
  if (!text.trim()) return [];
  const chunks: RagChunk[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) chunks.push(JSON.parse(trimmed) as RagChunk);
  }
  return chunks;
}

export async function deleteIndex(collectionId: string): Promise<void> {
  await deleteFile(indexPath(collectionId));
}
