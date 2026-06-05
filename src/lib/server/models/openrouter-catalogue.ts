import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { setSetting } from './settings';

interface OpenRouterRawModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string; image?: string | null };
  architecture?: { modality?: string };
}

interface OpenRouterEndpointStats {
  stats?: { p50_throughput?: number | null } | null;
}

export function deriveProvider(id: string): string {
  const idx = id.indexOf('/');
  return idx > 0 ? id.slice(0, idx) : 'unknown';
}

export function mapOpenRouterModel(raw: OpenRouterRawModel) {
  const pricing = raw.pricing ?? {};
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    description: raw.description ?? null,
    contextLength: raw.context_length ?? null,
    promptPrice: pricing.prompt ?? null,
    completionPrice: pricing.completion ?? null,
    imagePrice: pricing.image ?? null,
    modality: raw.architecture?.modality ?? null,
    provider: deriveProvider(raw.id),
    throughput: null as string | null,
    raw,
    fetchedAt: new Date(),
  };
}

/**
 * The OpenRouter /models list doesn't carry throughput, and the public
 * `/v1/models/{slug}/endpoints` API returns the throughput field nulled out.
 * The real numbers live on the frontend stats endpoint that powers the
 * website's per-provider throughput charts: each endpoint exposes
 * `stats.p50_throughput` (median tokens/sec over the last window). We take the
 * max p50 across a model's provider endpoints as its headline tokens/sec.
 * Variants that share a base slug (e.g. `:free`) resolve to the same permaslug,
 * so we dedupe by base slug to keep the request count down. Failures are
 * swallowed per model — a missing throughput just shows as "—" in the UI.
 */
async function fetchThroughput(baseSlug: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://openrouter.ai/api/frontend/stats/endpoint?permaslug=${baseSlug}`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return null;
    const body = await res.json();
    const endpoints: OpenRouterEndpointStats[] = Array.isArray(body) ? body : (body?.data ?? []);
    let max: number | null = null;
    for (const ep of endpoints) {
      const t = ep?.stats?.p50_throughput;
      if (typeof t === 'number' && Number.isFinite(t)) {
        max = max == null ? t : Math.max(max, t);
      }
    }
    return max;
  } catch {
    return null;
  }
}

/** Run `worker` over `items` with at most `limit` in flight at once. */
async function mapPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

export async function refreshOpenRouterCatalogue(): Promise<{ count: number }> {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`OpenRouter /models returned ${res.status}`);
  const json = await res.json();
  const models: OpenRouterRawModel[] = json.data ?? [];
  const mapped = models.map(mapOpenRouterModel);

  // Enrich with throughput, keyed by base slug (strip any `:variant` suffix)
  // so we hit the endpoints API once per distinct model.
  const baseSlugs = [...new Set(mapped.map((m) => m.id.split(':')[0]))];
  const throughputBySlug = new Map<string, number | null>();
  await mapPool(baseSlugs, 10, async (slug) => {
    throughputBySlug.set(slug, await fetchThroughput(slug));
  });
  for (const m of mapped) {
    const t = throughputBySlug.get(m.id.split(':')[0]);
    m.throughput = t == null ? null : String(t);
  }

  await db.transaction(async (tx) => {
    await tx.delete(openrouterModels);
    if (mapped.length > 0) {
      await tx.insert(openrouterModels).values(mapped);
    }
  });

  await setSetting('openrouter.last_refreshed_at', new Date().toISOString());
  return { count: models.length };
}
