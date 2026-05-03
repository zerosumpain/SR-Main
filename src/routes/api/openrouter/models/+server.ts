/**
 * GET /api/openrouter/models — full live OpenRouter model catalog.
 *
 * Powers the canvas dropdown's `dynamicOptionsKey: 'openrouter-models'`
 * resolver so node config picker shows EVERY model OpenRouter exposes,
 * not just the hand-picked subset baked into each node's def. Cached for
 * 5 min in-process to keep the canvas snappy without hammering the
 * upstream catalog endpoint.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { loadKeys } from '$lib/deepdive/keys';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

interface OpenRouterModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

interface CanvasOption { value: string; label: string }

let cache: { fetchedAt: number; options: CanvasOption[] } | null = null;

function shapeOption(m: OpenRouterModel): CanvasOption {
  const label = m.name && m.name !== m.id ? `${m.name} — ${m.id}` : m.id;
  return { value: m.id, label };
}

export const GET: RequestHandler = async () => {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return json({ options: cache.options, cached: true });
  }
  const keys = loadKeys();
  if (!keys.openrouterApiKey) {
    return json(
      { options: [], error: 'OpenRouter API key not configured' },
      { status: 500 },
    );
  }
  const res = await fetch(`${OPENROUTER_BASE}/models`, {
    headers: { Authorization: `Bearer ${keys.openrouterApiKey}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json(
      { options: [], error: `OpenRouter ${res.status}: ${text.slice(0, 200)}` },
      { status: 502 },
    );
  }
  const body = (await res.json()) as { data?: OpenRouterModel[] };
  const sorted = (body.data ?? []).slice().sort((a, b) => a.id.localeCompare(b.id));
  const options = sorted.map(shapeOption);
  cache = { fetchedAt: Date.now(), options };
  return json({ options, cached: false, count: options.length });
};
