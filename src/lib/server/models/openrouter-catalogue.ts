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
    raw,
    fetchedAt: new Date(),
  };
}

export async function refreshOpenRouterCatalogue(): Promise<{ count: number }> {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`OpenRouter /models returned ${res.status}`);
  const json = await res.json();
  const models: OpenRouterRawModel[] = json.data ?? [];

  await db.transaction(async (tx) => {
    await tx.delete(openrouterModels);
    if (models.length > 0) {
      await tx.insert(openrouterModels).values(models.map(mapOpenRouterModel));
    }
  });

  await setSetting('openrouter.last_refreshed_at', new Date().toISOString());
  return { count: models.length };
}
