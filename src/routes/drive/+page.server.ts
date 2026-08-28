import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { driveFolderSettings, fileEmbeddings, workflowFiles } from '$lib/db/schema';
import { desc, sql } from 'drizzle-orm';
import { indexStatusFor } from '$lib/file-index/index-status';
import { env } from '$env/dynamic/private';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { SHARE_TTL_DAYS } from '$lib/file-shares';

// Endpoint's own per-file cap (see /api/files/upload). The effective client-side
// limit is the smaller of this and the adapter's BODY_SIZE_LIMIT — exceeding
// BODY_SIZE_LIMIT makes the request body get rejected before the handler runs
// (opaque 500), so the /drive UI guards against it up front.
const MAX_BYTES = 50 * 1024 * 1024;

// Mirror @sveltejs/adapter-node's parse_as_bytes: number, or K/M/G suffix.
function parseBytes(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const m = /^(\d+(?:\.\d+)?)([KMG]?)$/i.exec(raw.trim());
  if (!m) return fallback;
  const n = parseFloat(m[1]);
  const mult = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[m[2].toUpperCase()] ?? 1;
  return Math.floor(n * mult);
}

export const load: PageServerLoad = async () => {
  const [files, siteDefault, folderRows, indexRows] = await Promise.all([
    db.select().from(workflowFiles).orderBy(desc(workflowFiles.updatedAt)),
    // The RAG chat panel starts on the site default like every other LLM
    // surface, rather than on the hard-coded code fallback.
    resolveDefaultModel(),
    // Per-folder entity-resolution policy. Loaded up front so folder tiles can
    // show whether their contents feed the Intel graph without a fetch per tile.
    db.select().from(driveFolderSettings),
    // One row per indexed file. Chunks of the same file always share a modality,
    // so min() just picks it deterministically.
    db
      .select({
        fileId: fileEmbeddings.fileId,
        chunks: sql<number>`count(*)::int`,
        modality: sql<string>`min(${fileEmbeddings.modality})`,
      })
      .from(fileEmbeddings)
      .groupBy(fileEmbeddings.fileId),
  ]);
  // adapter-node default is '512K' when BODY_SIZE_LIMIT is unset.
  const bodyLimit = parseBytes(env.BODY_SIZE_LIMIT, 512 * 1024);
  const maxUploadBytes = Math.min(bodyLimit, MAX_BYTES);
  const folderSettings = folderRows.map((r) => ({
    path: r.path,
    intelMode: r.intelMode,
    categoryIds: r.categoryIds ?? [],
  }));
  const indexByFile = new Map(indexRows.map((r) => [r.fileId, r]));
  const filesWithIndex = files.map((f) => {
    const hit = indexByFile.get(f.id);
    const chunks = hit?.chunks ?? 0;
    return {
      ...f,
      indexChunks: chunks,
      indexModality: hit?.modality ?? null,
      indexStatus: indexStatusFor(f, chunks),
    };
  });
  // The share list itself is fetched client-side (it changes without a reload),
  // but the lifetime is needed for button copy before that lands.
  return {
    files: filesWithIndex,
    maxUploadBytes,
    defaultChatModelId: siteDefault.modelId,
    folderSettings,
    shareTtlDays: SHARE_TTL_DAYS,
  };
};
