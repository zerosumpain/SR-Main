import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { and, or, sql, ilike, gte, lte, inArray, isNotNull, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { getSetting } from '$lib/server/models/settings';

const SORT_COLUMNS: Record<string, PgColumn> = {
  id: openrouterModels.id,
  name: openrouterModels.name,
  provider: openrouterModels.provider,
  modality: openrouterModels.modality,
  contextLength: openrouterModels.contextLength,
  promptPrice: openrouterModels.promptPrice,
  completionPrice: openrouterModels.completionPrice,
  throughput: openrouterModels.throughput,
};

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim();
  const providers = url.searchParams.getAll('provider').filter(Boolean);
  const modalities = url.searchParams.getAll('modality').filter(Boolean);
  const minContext = num(url.searchParams.get('minContext'));
  const maxCostPerM = num(url.searchParams.get('maxCostPerM')); // USD per 1M completion tokens
  const page = Math.max(1, num(url.searchParams.get('page')) ?? 1);
  const pageSize = Math.min(100, Math.max(1, num(url.searchParams.get('pageSize')) ?? 50));
  const sortBy = url.searchParams.get('sortBy') ?? 'id';
  const sortDir = url.searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc';
  // toolsOnly: restrict to models whose supported_parameters include "tools".
  // The jkai orchestrator is an agent and requires tool use — models without it
  // (e.g. morph/relace "apply" models) 404 with "No endpoints found that
  // support tool use". The chat model picker sets this.
  const toolsOnly = url.searchParams.get('toolsOnly') === '1';

  const sortCol = SORT_COLUMNS[sortBy];
  if (!sortCol) throw error(400, `invalid sortBy: ${sortBy}`);

  const conditions: SQL[] = [];
  if (q) conditions.push(or(ilike(openrouterModels.name, `%${q}%`), ilike(openrouterModels.id, `%${q}%`))!);
  if (providers.length) conditions.push(inArray(openrouterModels.provider, providers));
  if (modalities.length) conditions.push(inArray(openrouterModels.modality, modalities));
  if (minContext != null) conditions.push(gte(openrouterModels.contextLength, minContext));
  if (maxCostPerM != null) {
    // maxCostPerM is USD per 1M completion tokens; completion_price is USD per token
    conditions.push(lte(openrouterModels.completionPrice, String(maxCostPerM / 1_000_000)));
  }
  if (toolsOnly) {
    conditions.push(sql`(${openrouterModels.raw} -> 'supported_parameters') @> '["tools"]'::jsonb`);
  }

  const where = conditions.length ? and(...conditions) : undefined;

  // Facets: distinct provider/modality across the entire catalogue (not the filtered set)
  // so users can always see the full option list. Excludes nulls.
  const [countRows, providerRows, modalityRows, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(openrouterModels).where(where),
    db
      .selectDistinct({ value: openrouterModels.provider })
      .from(openrouterModels)
      .where(isNotNull(openrouterModels.provider))
      .orderBy(openrouterModels.provider),
    db
      .selectDistinct({ value: openrouterModels.modality })
      .from(openrouterModels)
      .where(isNotNull(openrouterModels.modality))
      .orderBy(openrouterModels.modality),
    db
      .select()
      .from(openrouterModels)
      .where(where)
      // NULLS LAST so unpriced / no-throughput models never sort above real
      // values (Postgres defaults to NULLS FIRST for DESC).
      .orderBy(sql`${sortCol} ${sql.raw(sortDir === 'desc' ? 'desc' : 'asc')} nulls last`)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ]);

  const lastRefreshed = await getSetting<string>('openrouter.last_refreshed_at');

  return json({
    rows,
    total: countRows[0]?.count ?? 0,
    page,
    pageSize,
    lastRefreshed,
    sortBy,
    sortDir,
    facets: {
      providers: providerRows.map((r) => r.value).filter((v): v is string => v != null),
      modalities: modalityRows.map((r) => r.value).filter((v): v is string => v != null),
    },
  });
};

function num(v: string | null): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
