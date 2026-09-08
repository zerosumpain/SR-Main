import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { CODEX_MODELS, toCodexModelId } from '$lib/server/models/codex-catalogue';
import { coerceModelContext } from '$lib/constants/default-models';
import { resolveBuilderModel } from '$lib/server/models/workload-settings';

/** Use the site's catalogue; provider authentication is checked by the worker. */
export async function developmentModels() {
  const rows = await db.select({ id: openrouterModels.id, name: openrouterModels.name, raw: openrouterModels.raw }).from(openrouterModels);
  const models = rows.filter(row => {
    const raw = row.raw as { supported_parameters?: string[] } | null;
    return raw?.supported_parameters?.includes('tools');
  }).map(({ id, name }) => ({ id, name, provider: 'openrouter' }));
  return [...CODEX_MODELS.map(m => ({ id: toCodexModelId(m.slug), name: m.name, provider: 'codex' })), ...models];
}
export async function resolveDevelopmentModel(value: unknown) {
  if (value === undefined || value === '') return resolveBuilderModel();
  if (typeof value !== 'string' || !(await developmentModels()).some(m => m.id === value)) {
    throw new Error('Choose a build model from the available catalogue.');
  }
  return coerceModelContext({ modelId: value });
}
