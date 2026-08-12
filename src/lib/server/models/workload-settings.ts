/**
 * Server side of the workload registry: resolve, describe and set the model for
 * each site-scope LLM role.
 *
 * Mirrors `$lib/routing/events.ts` — `resolve*` for the request path,
 * `describe*` for the picker, `set*` for the write — so the two model-selection
 * surfaces (routing profiles and workloads) behave the same way.
 *
 * The resolution order is deliberately the same everywhere:
 *   explicit setting  →  the registry's code fallback  →  the site default
 *
 * A role with `fallbackModelId: null` therefore follows the site default until
 * someone pins it, which is the state every role should be in unless there is a
 * documented reason not to.
 */
import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  getSetting,
  setSetting,
  deleteSetting,
  clearSettingsCache,
  resolveDefaultModel,
} from './settings';
import { coerceModelContext } from '$lib/constants/default-models';
import { getModelCapabilities, getProviderFeatures } from './capabilities';
import {
  SITE_WORKLOADS,
  emitsImages,
  type WorkloadDef,
  type WorkloadState,
  type WorkloadSource,
} from '$lib/models/workloads';
import type { ModelContext } from './types';

/**
 * The model for one site-scope workload.
 *
 * Cheap — `getSetting` is 30s-cached — so it is safe on a request path, which
 * matters because the extraction role is called per note during ingest.
 */
export async function resolveWorkloadModel(def: WorkloadDef): Promise<ModelContext> {
  const v = await getSetting<{ provider?: string; modelId?: string } | null>(def.key);
  if (v?.modelId) return coerceModelContext({ modelId: v.modelId });
  if (def.fallbackModelId) return coerceModelContext({ modelId: def.fallbackModelId });
  return resolveDefaultModel();
}

/** Look a workload up by id and resolve it. Throws on an unknown id — these are
 *  compile-time constants at every call site, so a miss is a bug, not input. */
async function resolveById(id: string): Promise<ModelContext> {
  const def = SITE_WORKLOADS.find((w) => w.id === id);
  if (!def) throw new Error(`unknown workload: ${id}`);
  return resolveWorkloadModel(def);
}

/**
 * Named resolvers — one per role, so a carve-out is visible at its call site
 * rather than implied by a bare settings key (the rule `settings.ts` sets out).
 *
 * These live here rather than in `settings.ts` to keep the import graph acyclic:
 * this module already depends on `settings.ts` for `getSetting`/`resolveDefaultModel`.
 */

/** Intel entity extraction + resolution. Two call sites, both post-reply. */
export const resolveExtractionModel = () => resolveById('extraction');

/** The nightly self-improvement engine's code-authoring calls. */
export const resolveSelfimproveModel = () => resolveById('selfimprove');

/** The workflow doctor's diagnosis calls. */
export const resolveDoctorModel = () => resolveById('doctor');

/** Image captioning / OCR for the file index. Must accept image input. */
export const resolveVisionModel = () => resolveById('vision');

/** Image GENERATION for the studio and the canvas image tool. */
export const resolveImageModel = () => resolveById('image');

/** RAG / file embeddings. Always OpenRouter — Codex has no embeddings endpoint. */
export const resolveEmbeddingModel = () => resolveById('embeddings');

/** Audio transcription for the @files index. Must accept audio input. */
export const resolveAudioModel = () => resolveById('audio');

/** Deck slide art direction. */
export const resolveArtDirectorModel = () => resolveById('art-director');

function sourceFor(def: WorkloadDef, set: string | null): WorkloadSource {
  if (set) return 'pinned';
  return def.fallbackModelId ? 'code' : 'default';
}

/** Every site workload's set / effective model, for the picker and the audit. */
export async function describeSiteWorkloads(): Promise<WorkloadState[]> {
  const siteDefault = await resolveDefaultModel();
  const stored = await Promise.all(
    SITE_WORKLOADS.map((w) =>
      getSetting<{ modelId?: string } | null>(w.key).then((v) => v?.modelId ?? null),
    ),
  );

  return SITE_WORKLOADS.map((def, i) => {
    const setModelId = stored[i];
    const effectiveModelId =
      setModelId ?? def.fallbackModelId ?? siteDefault.modelId;
    return {
      id: def.id,
      scope: def.scope,
      label: def.label,
      blurb: def.blurb,
      key: def.key,
      reason: def.reason,
      requires: def.requires,
      catalogue: def.catalogue,
      setModelId,
      effectiveModelId,
      source: sourceFor(def, setModelId),
      divergesFromDefault: effectiveModelId !== siteDefault.modelId,
    };
  });
}

/**
 * Why `modelId` cannot serve `def`, or null if it can.
 *
 * Refused at SAVE time rather than call time on purpose. The failure this
 * prevents is not a crash — it is a plausible wrong answer: a text-only model
 * handed an image request answers the prompt and ignores the picture, and the
 * caption reads fine until you compare it with the file.
 *
 * Where the catalogue cannot answer the question, this returns null rather than
 * guessing. A guard that blocks on missing data would make the embeddings role
 * unsettable, since OpenRouter's feed carries no embedding models at all.
 */
export async function workloadBlockReason(
  def: WorkloadDef,
  modelId: string,
): Promise<string | null> {
  const ctx = coerceModelContext({ modelId });

  switch (def.requires) {
    case 'tools':
      return getProviderFeatures(ctx.provider).tools
        ? null
        : `${ctx.provider} cannot pass tool schemas, which ${def.label} needs.`;

    case 'embeddings':
      return getProviderFeatures(ctx.provider).embeddings
        ? null
        : `${ctx.provider} has no embeddings endpoint. Use an OpenRouter model for ${def.label}.`;

    case 'image-input':
      return getModelCapabilities(ctx).image
        ? null
        : `${modelId} cannot accept images, so it cannot serve ${def.label}. It would answer the prompt and ignore the picture.`;

    case 'audio-input':
      return getModelCapabilities(ctx).audio
        ? null
        : `${modelId} cannot accept audio, so it cannot serve ${def.label}.`;

    case 'image-output': {
      if (ctx.provider === 'codex') {
        return `Codex cannot return an image, so it cannot serve ${def.label}.`;
      }
      const [row] = await db
        .select({ modality: openrouterModels.modality })
        .from(openrouterModels)
        .where(eq(openrouterModels.id, modelId))
        .limit(1);
      // Not in the catalogue → unknown, not disproven. `flux-1.1-pro` is a real
      // image model OpenRouter's /models feed omits, and blocking it here would
      // refuse the value the site already ships with.
      if (!row) return null;
      return emitsImages(row.modality)
        ? null
        : `${modelId} does not emit images (modality ${row.modality ?? 'unknown'}), so it cannot serve ${def.label}.`;
    }

    case null:
      return null;
  }
}

/**
 * Pin a workload to a model, or clear the pin with `null`.
 *
 * Clearing hands the role back to its code fallback if it has one, and to the
 * site default if it does not — the same "unset means follow" semantics the
 * routing pins use.
 */
export async function setWorkloadModel(
  def: WorkloadDef,
  modelId: string | null,
): Promise<void> {
  if (modelId === null) {
    // Delete, not a null write — see deleteSetting: the column is jsonb NOT NULL.
    await deleteSetting(def.key);
  } else {
    await setSetting(def.key, coerceModelContext({ modelId }));
  }
  clearSettingsCache();
}
