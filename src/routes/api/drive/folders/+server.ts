// Per-folder Drive settings: whether the folder feeds entity resolution, and
// which ER categories everything under it carries.
//
//   GET  ?path=…  the stored row for one folder plus its RESOLVED policy
//        (no path) every stored row + every category, for the /drive UI
//   PUT           save one folder's settings and re-sync everything beneath it
//
// The re-sync is the point: without it, excluding a folder would only stop
// FUTURE extraction and leave the entities already in the graph, which is the
// same "source removed, intel survives" bug this release fixes elsewhere.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { driveFolderSettings, intelCategories } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { isIntelMode, normalisePath, resolveFolderPolicy } from '$lib/jkai/intel/source-policy';
import { loadSourcePolicyContext, syncSourcePolicy } from '$lib/jkai/intel/source-policy.server';

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
    categories: ctx.categories,
  });
};

export const PUT: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const path = normalisePath(String(body.path ?? ''));
  const intelMode = isIntelMode(body.intelMode) ? body.intelMode : 'inherit';

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
      .set({ intelMode, categoryIds, updatedAt: new Date() })
      .where(eq(driveFolderSettings.id, existing.id))
      .returning();
  } else {
    [saved] = await db
      .insert(driveFolderSettings)
      .values({ path, intelMode, categoryIds })
      .returning();
  }

  // Scoped to this subtree — sweeping the whole Drive on every save would make
  // a one-folder edit cost an all-files pass.
  const sync = await syncSourcePolicy(path);

  return json({ folder: saved, sync });
};
