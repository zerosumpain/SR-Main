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
  const session = await sessionModelForWorkload(def);
  if (session) return session;
  const v = await getSetting<{ provider?: string; modelId?: string } | null>(def.key);
  if (v?.modelId) return coerceModelContext({ modelId: v.modelId });
  if (def.fallbackModelId) return coerceModelContext({ modelId: def.fallbackModelId });
  return resolveDefaultModel();
}

/**
 * The chat session's pinned model, when this role can actually run on it.
 *
 * A model chosen in the /jkai composer is meant to serve the whole session, not
 * just the reply — the tools it calls, the builds it starts, and the roles those
 * reach. This is where every site workload opts in, so the answer is the same
 * everywhere instead of being decided one call site at a time.
 *
 * Two things make it safe to put in front of the pin and the fallback:
 *
 * 1. **It is null unless the OWNER chose.** The store is only populated for a
 *    thread whose `model_pinned_by_user` is set. Every scheduled job, nightly
 *    pass, workflow run and unpinned thread has no store at all and resolves
 *    exactly as it did before.
 * 2. **It is withdrawn when the role needs something the model has not got.**
 *    `def.requires` already states each role's capability — the registry the
 *    picker filters on — so the check is the registry's own, not a second
 *    opinion about it. A text-only pin reaching the vision role does not
 *    degrade an extract, it FAILS one, and a failed extract stamps the file's
 *    hash so a later fix re-indexes nothing.
 *
 * `embeddings` can never pass, and that is deliberate rather than an oversight:
 * no chat model in the catalogue is an embedding model, and vectors from a
 * mismatched one land in a fixed-dimension column that cannot hold them.
 */
async function sessionModelForWorkload(def: WorkloadDef): Promise<ModelContext | null> {
  const { currentSessionModel } = await import('$lib/context/chat');
  const pinned = currentSessionModel();
  if (!pinned) return null;

  switch (def.requires) {
    // Chat models, which is what the picker offers — the pin is one by
    // construction. `null` is a role with no requirement at all.
    case 'tools':
    case null:
      return pinned;
    case 'image-input':
      return getModelCapabilities(pinned).image ? pinned : null;
    case 'audio-input':
      return getModelCapabilities(pinned).audio ? pinned : null;
    case 'image-output':
      return (await modelEmitsImages(pinned)) ? pinned : null;
    // See the note above: not a gate that happens to fail, a role the session
    // model is the wrong KIND of thing for.
    case 'embeddings':
      return null;
    default:
      return null;
  }
}

/** Whether the catalogue says this model emits images. False on a lookup
 *  failure — this sits on the generation path and must fall back, not throw. */
async function modelEmitsImages(ctx: ModelContext): Promise<boolean> {
  try {
    const [row] = await db
      .select({ modality: openrouterModels.modality })
      .from(openrouterModels)
      .where(eq(openrouterModels.id, ctx.modelId))
      .limit(1);
    return emitsImages(row?.modality);
  } catch (err) {
    console.warn(
      `[models] modality lookup failed for ${ctx.modelId}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
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

/** Adjudicating one candidate duplicate pair against its evidence. */
export const resolveResolutionModel = () => resolveById('resolution');

/** The nightly self-improvement engine's code-authoring calls. */
export const resolveSelfimproveModel = () => resolveById('selfimprove');

/** The workflow doctor's diagnosis calls. */
export const resolveDoctorModel = () => resolveById('doctor');

/**
 * Image captioning / OCR for the file index. Must accept image input.
 *
 * Order of precedence: an explicit pin in `jkai.vision.model` wins, then the
 * nightly router's `vision` assignment, then the hard-coded fallback.
 *
 * The router is consulted because this runs over every image and every scanned
 * PDF in the Drive, so the right model is "cheapest that reads the page
 * properly" — a judgement the cost-aware selector already makes nightly against
 * the live catalogue, and one a constant in the source cannot make at all. That
 * constant was `openai/gpt-4o-mini` for months, which refused one document in
 * three.
 *
 * `selectModels` filters the vision pool to models that declare image input, so
 * the assignment cannot be a text-only model. Everything still falls back to the
 * constant if the nightly run has never produced an assignment, or if reading it
 * fails — this is on the indexing path and must not throw.
 */
export async function resolveVisionModel(): Promise<ModelContext> {
  const def = SITE_WORKLOADS.find((w) => w.id === 'vision')!;
  // Ahead of the explicit pin for the same reason it is in resolveWorkloadModel:
  // a session model the owner chose serves the whole session. Gated on
  // `requires: 'image-input'`, so a text-only chat model never reaches here.
  const session = await sessionModelForWorkload(def);
  if (session) return session;
  const pinned = await getSetting<{ provider?: string; modelId?: string } | null>(def.key);
  if (pinned?.modelId) return coerceModelContext({ modelId: pinned.modelId });

  try {
    const { isRoutingEnabled, loadAssignments, loadOverrides } = await import('$lib/routing/events');
    // The kill switch means "stop letting the router choose", everywhere — not
    // just in chat. With it off, the constant answers.
    if (await isRoutingEnabled()) {
      // Overrides before assignments, matching resolveModelForProfile. The
      // routing admin page lists every profile in PROFILES, so `vision` is now
      // pinnable there; reading only the nightly assignment would accept the pin
      // in the UI and then quietly ignore it.
      const pin = (await loadOverrides()).vision;
      if (pin?.modelId) return coerceModelContext({ modelId: pin.modelId });
      const assigned = (await loadAssignments()).vision;
      if (assigned?.modelId) return coerceModelContext({ modelId: assigned.modelId });
    }
  } catch (err) {
    console.warn(`[models] vision routing lookup failed (${(err as Error).message}); using the fallback`);
  }
  return coerceModelContext({ modelId: def.fallbackModelId! });
}

/** Image GENERATION for the studio explainer images (chat-completions). */
export const resolveImageModel = () => resolveById('image');

/**
 * The `generate_image` tool's model (/images/generations).
 *
 * NOT FLUX any more: OpenRouter removed `black-forest-labs/flux-1.1-pro` and
 * the endpoint 404s for it. See DEFAULT_IMAGE_TOOL_MODEL_ID.
 *
 * Precedence: an explicit pin, then the legacy `JKAI_IMAGE_MODEL` env var, then
 * the constant. The env var is honoured HERE rather than in the constants module
 * because that module is client-importable — and it sits below the pin so that
 * setting the model from the page beats a stale variable in a `.env` nobody has
 * looked at since it was written.
 */
export async function resolveImageToolModel(): Promise<ModelContext> {
  const def = SITE_WORKLOADS.find((w) => w.id === 'image-tool')!;
  // Gated on `requires: 'image-output'` — a chat model that only emits text
  // never reaches here, so the session pin cannot turn image generation into a
  // 400 on a thread that happened to be on a text model.
  const session = await sessionModelForWorkload(def);
  if (session) return session;
  const pinned = await getSetting<{ modelId?: string } | null>(def.key);
  if (pinned?.modelId) return coerceModelContext({ modelId: pinned.modelId });
  const fromEnv = envModelFor(def);
  if (fromEnv) return coerceModelContext({ modelId: fromEnv });
  return coerceModelContext({ modelId: def.fallbackModelId! });
}

/** A role's legacy env-var model, when it declares one and it is set. Server
 *  only — `$lib/models/workloads` is client-importable and must not read
 *  `process.env`, so the registry declares the NAME and this reads the value. */
function envModelFor(def: WorkloadDef): string | null {
  if (!def.envKey) return null;
  const v = process.env[def.envKey];
  return v && v.trim() ? v.trim() : null;
}

/** RAG / file embeddings. Always OpenRouter — Codex has no embeddings endpoint. */
export const resolveEmbeddingModel = () => resolveById('embeddings');

/** Audio transcription for the @files index. Must accept audio input. */
export const resolveAudioModel = () => resolveById('audio');

/** Deck slide art direction. */
export const resolveArtDirectorModel = () => resolveById('art-director');

function sourceFor(def: WorkloadDef, set: string | null): WorkloadSource {
  if (set) return 'pinned';
  if (envModelFor(def)) return 'env';
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
    // Same order as `resolveImageToolModel`: pin, then the legacy env var, then
    // the code fallback. Reading them in different orders is how the page ends
    // up naming a model nothing is running.
    const effectiveModelId =
      setModelId ?? envModelFor(def) ?? def.fallbackModelId ?? siteDefault.modelId;
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
