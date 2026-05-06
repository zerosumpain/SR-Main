import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { ModelContext, PriceSnapshot } from './types';

export async function snapshotPrice(ctx: ModelContext): Promise<PriceSnapshot | null> {
  if (ctx.provider !== 'openrouter') return null;
  const [row] = await db
    .select()
    .from(openrouterModels)
    .where(eq(openrouterModels.id, ctx.modelId))
    .limit(1);
  if (!row) return null;
  return {
    promptPrice: Number(row.promptPrice ?? 0),
    completionPrice: Number(row.completionPrice ?? 0),
  };
}
