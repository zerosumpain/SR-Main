// Per-folder Drive settings: whether the folder feeds entity resolution, and
// which ER categories everything under it carries.
//
//   GET  ?path=…  the stored row for one folder plus its RESOLVED policy
//        (no path) every stored row + every category, for the /drive UI
//   PUT           save one folder's settings and queue a re-sync of everything
//                 beneath it
//
//   space (PUT body, optional): 'owner' | 'household' | null — which intel space
//        this folder's files land in; null inherits. Absent leaves it as it is,
//        so a Drive build that predates spaces cannot reset it by saving.
//
// The re-sync is the point: without it, excluding a folder would only stop
// FUTURE extraction and leave the entities already in the graph, which is the
// same "source removed, intel survives" bug this release fixes elsewhere.
//
// SR-Jkai-Core runs it: a `policy-resync` job on the intel outbox, drained within
// seconds. So the PUT answers `sync: { queued: true, jobId, filesConsidered }`
// — how many of the owner's files sit under the folder and will be re-checked —
// rather than what the re-sync did, which is not known yet. SR-Drive's folder
// modal reads `filesConsidered` and treats the other counts as optional.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { driveFolderSettings, intelCategories, workflowFiles, type IntelCategory } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  folderOf,
  isIntelMode,
  isUnder,
  normalisePath,
  resolveFolderPolicy,
  type FolderSetting,
} from '$lib/intel-client/source-policy';
import { isDriveSpace, resolveFolderSpace, type FolderSpaceSetting } from '$lib/intel-client/source-space';
import { enqueueIntelJob } from '$lib/intel-client/outbox';

/** Everything the resolvers need, in one round trip. */
async function loadSourcePolicyContext(): Promise<{
  settings: FolderSetting[];
  spaces: FolderSpaceSetting[];
  categories: IntelCategory[];
}> {
  const [settingRows, categories] = await Promise.all([
    db.select().from(driveFolderSettings),
    db.select().from(intelCategories).orderBy(intelCategories.name),
  ]);
  return {
    settings: settingRows.map((r) => ({
      path: normalisePath(r.path),
      intelMode: isIntelMode(r.intelMode) ? r.intelMode : 'inherit',
      categoryIds: r.categoryIds ?? [],
    })),
    spaces: settingRows.map((r) => ({
      path: normalisePath(r.path),
      spaceId: isDriveSpace(r.spaceId) ? r.spaceId : null,
    })),
    categories,
  };
}

/** The owner's files under a folder — the ones a re-sync will re-check. Members' files never had intel. */
async function ownerFilesUnder(path: string): Promise<number> {
  const files = await db
    .select({ name: workflowFiles.name })
    .from(workflowFiles)
    .where(eq(workflowFiles.principalId, 'owner'));
  return files.filter((f) => isUnder(folderOf(f.name), path)).length;
}

export const GET: RequestHandler = async ({ url }) => {
  const rawPath = url.searchParams.get('path');
  const ctx = await loadSourcePolicyContext();

  if (rawPath === null) {
    const rows = await db.select().from(driveFolderSettings);
    return json({ folders: rows, categories: ctx.categories });
  }

  const path = normalisePath(rawPath);
  const [row] = await db
    .select()
    .from(driveFolderSettings)
    .where(eq(driveFolderSettings.path, path))
    .limit(1);

  return json({
    path,
    folder: row ?? null,
    resolved: resolveFolderPolicy(path, ctx.settings),
    resolvedSpace: resolveFolderSpace(path, ctx.spaces),
    categories: ctx.categories,
  });
};

export const PUT: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const path = normalisePath(String(body.path ?? ''));
  const intelMode = isIntelMode(body.intelMode) ? body.intelMode : 'inherit';
  const rawSpace: unknown = (body as Record<string, unknown>).space;
  if (rawSpace !== undefined && rawSpace !== null && !isDriveSpace(rawSpace)) {
    return json({ error: "space must be 'owner', 'household' or null" }, { status: 400 });
  }
  // undefined = not sent = keep what is stored.
  const space = rawSpace === undefined ? undefined : (rawSpace as string | null);

  const rawIds: unknown = (body as Record<string, unknown>).categoryIds;
  const requested: string[] = Array.isArray(rawIds) ? rawIds.map((v) => String(v)) : [];
  // Drop ids whose category has since been deleted, rather than storing a
  // dangling reference that resolves to nothing on every read.
  const known = new Set((await db.select({ id: intelCategories.id }).from(intelCategories)).map((c) => c.id));
  const categoryIds: string[] = [...new Set(requested.filter((id) => known.has(id)))];

  const [existing] = await db
    .select()
    .from(driveFolderSettings)
    .where(eq(driveFolderSettings.path, path))
    .limit(1);

  let saved;
  if (existing) {
    [saved] = await db
      .update(driveFolderSettings)
      .set({ intelMode, categoryIds, ...(space !== undefined ? { spaceId: space } : {}), updatedAt: new Date() })
      .where(eq(driveFolderSettings.id, existing.id))
      .returning();
  } else {
    [saved] = await db
      .insert(driveFolderSettings)
      .values({ path, intelMode, categoryIds, spaceId: space ?? null })
      .returning();
  }

  // Scoped to this subtree — sweeping the whole Drive on every save would make
  // a one-folder edit cost an all-files pass.
  const [jobId, filesConsidered] = await Promise.all([
    enqueueIntelJob('policy-resync', path, undefined),
    ownerFilesUnder(path),
  ]);

  return json({ folder: saved, sync: { queued: true, jobId, filesConsidered } });
};
