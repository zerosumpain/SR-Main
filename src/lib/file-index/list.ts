// The /drive file list, enriched with its @files index status.
//
// One place, because the two callers used to disagree: `GET /api/files`
// returned bare rows while the page loader returned enriched ones, so /drive's
// own refresh — which every upload, move and delete triggers — silently blanked
// the index status across the whole page and drove the vitals band to "0 of 0".
import { db } from '$lib/db';
import { fileEmbeddings, workflowFiles } from '$lib/db/schema';
import { desc, sql } from 'drizzle-orm';
import { indexStatusFor, type IndexStatus } from './index-status';

export type FileWithIndex = typeof workflowFiles.$inferSelect & {
  indexChunks: number;
  indexModality: string | null;
  indexStatus: IndexStatus;
};

export async function listFilesWithIndex(): Promise<FileWithIndex[]> {
  const [rows, indexRows] = await Promise.all([
    db.select().from(workflowFiles).orderBy(desc(workflowFiles.updatedAt)),
    // Chunks of one file always share a modality, so min() picks it
    // deterministically.
    db
      .select({
        fileId: fileEmbeddings.fileId,
        chunks: sql<number>`count(*)::int`,
        modality: sql<string>`min(${fileEmbeddings.modality})`,
      })
      .from(fileEmbeddings)
      .groupBy(fileEmbeddings.fileId),
  ]);
  const byFile = new Map(indexRows.map((r) => [r.fileId, r]));
  return rows.map((r) => {
    const hit = byFile.get(r.id);
    const chunks = hit?.chunks ?? 0;
    return {
      ...r,
      indexChunks: chunks,
      indexModality: hit?.modality ?? null,
      indexStatus: indexStatusFor(r, chunks),
    };
  });
}
