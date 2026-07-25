import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { workflowFiles } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { resolveDefaultModel } from '$lib/server/models/settings';

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
  const [files, siteDefault] = await Promise.all([
    db.select().from(workflowFiles).orderBy(desc(workflowFiles.updatedAt)),
    // The RAG chat panel starts on the site default like every other LLM
    // surface, rather than on the hard-coded code fallback.
    resolveDefaultModel(),
  ]);
  // adapter-node default is '512K' when BODY_SIZE_LIMIT is unset.
  const bodyLimit = parseBytes(env.BODY_SIZE_LIMIT, 512 * 1024);
  const maxUploadBytes = Math.min(bodyLimit, MAX_BYTES);
  return { files, maxUploadBytes, defaultChatModelId: siteDefault.modelId };
};
