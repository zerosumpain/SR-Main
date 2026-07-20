// Owner-gated (hooks.server.ts). Read/update the routing kill switch + policy.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  isRoutingEnabled,
  getRoutingConfig,
  setRoutingConfig,
  setRoutingEnabled,
} from '$lib/routing/events';
import { DEFAULT_CONFIG, PRICE_WEIGHT_CAP, type RoutingConfig } from '$lib/routing/types';

export const GET: RequestHandler = async () => {
  const [enabled, config] = await Promise.all([isRoutingEnabled(), getRoutingConfig()]);
  return json({ enabled, config, defaults: DEFAULT_CONFIG, priceWeightCap: PRICE_WEIGHT_CAP });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));

  if (typeof body.enabled === 'boolean') {
    await setRoutingEnabled(body.enabled);
  }

  if (body.config) {
    const c = body.config as Partial<RoutingConfig>;
    // Merge onto current so a partial update is safe, then sanity-clamp.
    const current = await getRoutingConfig();
    const merged: RoutingConfig = {
      weights: { ...current.weights, ...(c.weights ?? {}) },
      qualityFloorPct: { ...current.qualityFloorPct, ...(c.qualityFloorPct ?? {}) },
      priceCeilingPerM: clampNum(c.priceCeilingPerM, current.priceCeilingPerM, 0.5, 500),
      minContext: clampNum(c.minContext, current.minContext, 0, 2_000_000),
      successBiasK: clampNum(c.successBiasK, current.successBiasK, 0, 0.5),
    };
    for (const p of Object.keys(merged.qualityFloorPct)) {
      const v = merged.qualityFloorPct[p as keyof typeof merged.qualityFloorPct];
      if (!(v >= 0 && v <= 100)) throw error(400, `qualityFloorPct.${p} must be 0-100`);
    }
    await setRoutingConfig(merged);
    return json({ ok: true, enabled: await isRoutingEnabled(), config: merged });
  }

  return json({ ok: true, enabled: await isRoutingEnabled(), config: await getRoutingConfig() });
};

function clampNum(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
