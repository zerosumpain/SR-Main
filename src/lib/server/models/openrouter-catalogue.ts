import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { setSetting } from './settings';
import { clearCapabilityCache } from './capabilities';
import { clearPriceCache } from '$lib/llm/pricing';

interface OpenRouterRawModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string; image?: string | null };
  // input_modalities is what capabilities are derived from — the whole raw
  // object is persisted, so it reaches the DB whether or not it is declared
  // here, but declaring it stops the field looking accidental.
  architecture?: { modality?: string; input_modalities?: string[] };
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
 * The real numbers lived on the undocumented frontend stats endpoint that
 * powers the website's per-provider throughput charts (`stats.p50_throughput`,
 * median tokens/sec). That endpoint started 404ing in 2026-07 — it is probed
 * once per refresh, and when it is dead (or fails per model) the PREVIOUSLY
 * stored throughput is carried forward rather than nulled, so the hybrid
 * score's speed axis keeps its last-known-good data. A missing throughput just
 * shows as "—" in the UI and scores neutral.
 */
async function fetchThroughput(baseSlug: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://openrouter.ai/api/frontend/stats/endpoint?permaslug=${baseSlug}`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) return null;
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

/** True when the frontend stats endpoint is serving JSON at all (it 404s with
 *  an HTML shell when dead). Distinguishes "endpoint gone" from "this model
 *  has no stats", so a revived endpoint isn't skipped. */
async function statsEndpointAlive(baseSlug: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://openrouter.ai/api/frontend/stats/endpoint?permaslug=${baseSlug}`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) },
    );
    return res.ok && (res.headers.get('content-type') ?? '').includes('json');
  } catch {
    return false;
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

  // Last-known-good throughput per model id, carried forward when the stats
  // source can't provide a fresh number (the delete+reinsert below would
  // otherwise wipe it).
  const previous = new Map(
    (
      await db
        .select({ id: openrouterModels.id, throughput: openrouterModels.throughput })
        .from(openrouterModels)
    ).map((r) => [r.id, r.throughput]),
  );

  // Enrich with throughput, keyed by base slug (strip any `:variant` suffix)
  // so we hit the stats API once per distinct model. Probe one slug first —
  // when the endpoint is dead entirely, skip the other ~340 requests.
  const baseSlugs = [...new Set(mapped.map((m) => m.id.split(':')[0]))];
  const throughputBySlug = new Map<string, number | null>();
  if (baseSlugs.length && (await statsEndpointAlive(baseSlugs[0]))) {
    await mapPool(baseSlugs, 10, async (slug) => {
      throughputBySlug.set(slug, await fetchThroughput(slug));
    });
  } else {
    console.warn('[openrouter-catalogue] frontend stats endpoint unavailable — carrying forward stored throughput');
  }
  for (const m of mapped) {
    const t = throughputBySlug.get(m.id.split(':')[0]);
    m.throughput = t != null ? String(t) : (previous.get(m.id) ?? null);
  }

  await db.transaction(async (tx) => {
    await tx.delete(openrouterModels);
    if (mapped.length > 0) {
      await tx.insert(openrouterModels).values(mapped);
    }
  });

  // Capabilities and pricing are both derived from this table and cached in
  // memory for their synchronous callers, so a refresh that does not drop those
  // caches leaves the process answering from the previous snapshot until it
  // restarts — which is how a hand-maintained list goes stale in the first place.
  clearCapabilityCache();
  clearPriceCache();

  await setSetting('openrouter.last_refreshed_at', new Date().toISOString());
  return { count: models.length };
}
