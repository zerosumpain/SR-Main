import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { driveFolderSettings } from '$lib/db/schema';
import { listFilesWithIndex } from '$lib/file-index/list';
import { env } from '$env/dynamic/private';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { SHARE_TTL_DAYS } from '$lib/file-shares';

// The endpoint's own per-file cap (see /api/files/upload). The effective
// client-side limit is the smaller of this and the adapter's BODY_SIZE_LIMIT —
// exceeding BODY_SIZE_LIMIT gets the request body rejected before the handler
// runs (an opaque 500), so the /drive UI guards against it up front.
const MAX_BYTES = 50 * 1024 * 1024;

// Mirror @sveltejs/adapter-node's parse_as_bytes: number, or K/M/G suffix.
function parseBytes(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const m = /^(\d+(?:\.\d+)?)([KMG]?)$/i.exec(raw.trim());
  if (!m) return fallback;
  const mult = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[m[2].toUpperCase()] ?? 1;
  return Math.floor(parseFloat(m[1]) * mult);
}

export const load: PageServerLoad = async () => {
  const [files, siteDefault, folderRows] = await Promise.all([
    listFilesWithIndex(),
    // The RAG chat panel starts on the site default like every other LLM
    // surface, rather than on a hard-coded code fallback.
    resolveDefaultModel(),
    // Per-folder entity-resolution policy, loaded up front so folder tiles can
    // show whether their contents feed the Intel graph without a fetch per tile.
    db.select().from(driveFolderSettings),
  ]);
  // adapter-node's default is '512K' when BODY_SIZE_LIMIT is unset.
  const bodyLimit = parseBytes(env.BODY_SIZE_LIMIT, 512 * 1024);
  // The share list itself is fetched client-side (it changes without a reload),
  // but the lifetime is needed for button copy before that lands.
  return {
    // `disk_path` is an absolute server path and has no business in page
    // data, owner-only page or not.
    files: files.map(({ diskPath: _p, contentHash: _h, ...rest }) => rest),
    maxUploadBytes: Math.min(bodyLimit, MAX_BYTES),
    defaultChatModelId: siteDefault.modelId,
    folderSettings: folderRows.map((r) => ({
      path: r.path,
      intelMode: r.intelMode,
      categoryIds: r.categoryIds ?? [],
    })),
    shareTtlDays: SHARE_TTL_DAYS,
  };
};
