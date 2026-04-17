import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { and, or, sql, ilike, gte, lte, inArray, type SQL } from 'drizzle-orm';
import { getSetting } from '$lib/server/models/settings';

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim();
  const providers = url.searchParams.getAll('provider').filter(Boolean);
  const modalities = url.searchParams.getAll('modality').filter(Boolean);
  const minContext = num(url.searchParams.get('minContext'));
  const maxCostPerM = num(url.searchParams.get('maxCostPerM')); // USD per 1M completion tokens
  const page = Math.max(1, num(url.searchParams.get('page')) ?? 1);
  const pageSize = Math.min(100, Math.max(1, num(url.searchParams.get('pageSize')) ?? 50));

  const conditions: SQL[] = [];
  if (q) conditions.push(or(ilike(openrouterModels.name, `%${q}%`), ilike(openrouterModels.id, `%${q}%`))!);
  if (providers.length) conditions.push(inArray(openrouterModels.provider, providers));
  if (modalities.length) conditions.push(inArray(openrouterModels.modality, modalities));
  if (minContext != null) conditions.push(gte(openrouterModels.contextLength, minContext));
  if (maxCostPerM != null) {
    // maxCostPerM is USD per 1M completion tokens; completion_price is USD per token
    conditions.push(lte(openrouterModels.completionPrice, String(maxCostPerM / 1_000_000)));
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(openrouterModels)
    .where(where);

  const rows = await db
    .select()
    .from(openrouterModels)
    .where(where)
    .orderBy(openrouterModels.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const lastRefreshed = await getSetting<string>('openrouter.last_refreshed_at');

  return json({ rows, total: count, page, pageSize, lastRefreshed });
};

function num(v: string | null): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
