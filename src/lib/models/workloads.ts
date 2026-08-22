/**
 * The registry of LLM WORKLOADS — every role on the site that picks a model
 * somewhere other than `resolveDefaultModel()`.
 *
 * Why this exists. The site is meant to run one default model everywhere
 * (John, 2026-07-25). In practice three classes of work escaped that rule and
 * nothing in the UI said so:
 *
 *  1. deliberate carve-outs with a settings key but no surface — intel entity
 *     extraction has had `jkai.intel.extract_model` since 2026-07-27, unset in
 *     production, so it silently ran the code fallback;
 *  2. roles hardcoded as module constants with NO settings key at all —
 *     self-improve and the workflow doctor, both pinned to
 *     `deepseek/deepseek-v4-flash` in their `types.ts`; and
 *  3. the Hermes engine, which keeps its OWN model config in
 *     `~/.hermes-jkai/config.yaml` that the site had never written to. That is
 *     where most of the residual OpenRouter spend actually lived: with the site
 *     default on `codex/gpt-5.6-terra`, Hermes' own `model.default` still billed
 *     439 OpenRouter calls in the 7 days to 2026-08-12, none of them visible in
 *     `agent_actions` because Hermes bypasses the SvelteKit gateway.
 *
 * A carve-out is legitimate — several here are load-bearing, and the `reason`
 * field records why — but an INVISIBLE carve-out is not, because the only way
 * to discover one was to read the source. Every role now names itself here,
 * says what runs on it, and can be changed from the model picker.
 *
 * This module is deliberately client-importable (plain data, no `$lib/server`
 * imports) so the picker renders the same list the server enforces — same rule
 * as `$lib/models/open-weights.ts`.
 */
import {
  DEFAULT_EXTRACTION_MODEL_ID,
  DEFAULT_SELFIMPROVE_MODEL_ID,
  DEFAULT_DOCTOR_MODEL_ID,
  DEFAULT_VISION_MODEL_ID,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_IMAGE_TOOL_MODEL_ID,
  DEFAULT_EMBEDDING_MODEL_ID,
  DEFAULT_AUDIO_MODEL_ID,
  DEFAULT_ART_DIRECTOR_MODEL_ID,
} from '$lib/constants/default-models';

/** Where the setting lives, which decides how a change is applied. */
export type WorkloadScope =
  /** An `app_settings` row read by a named resolver in the SvelteKit app. */
  | 'site'
  /** A dotted key in Hermes' own config.yaml, written with `hermes config set`
   *  and picked up on the next gateway restart. */
  | 'hermes';

/**
 * What a model must be able to do to serve this role.
 *
 * Checked server-side before a save is accepted, so an impossible pick is
 * refused with a reason rather than failing at call time — the failure mode
 * this replaces was a text-only model accepting an image request and confidently
 * describing nothing (see `file-index/describe.ts`).
 */
export type WorkloadRequirement =
  /** Caller-supplied tool schemas + tool_calls back. */
  | 'tools'
  /** The /v1/embeddings endpoint. Codex has none. */
  | 'embeddings'
  /** Accepts images as INPUT (vision / OCR). */
  | 'image-input'
  /** Accepts audio as INPUT (transcription). */
  | 'audio-input'
  /** Emits images as OUTPUT (generation). */
  | 'image-output'
  | null;

/**
 * Which models the picker should offer while this workload is the active
 * target. The default table is filtered to tool-capable chat models, which is
 * wrong for image generation and useless for embeddings.
 */
export type WorkloadCatalogue =
  /** Tool-capable chat models — the picker's normal filter. */
  | 'tools'
  /** Models whose modality has `image` on the output side (11 in the live catalogue). */
  | 'image-out'
  /** Nothing in the OpenRouter catalogue serves this role; the effective value
   *  is shown and set by hand. OpenRouter's /models feed omits the embedding
   *  namespace entirely, so there is genuinely nothing to list. */
  | 'none';

export interface WorkloadDef {
  id: string;
  scope: WorkloadScope;
  /** Chip / row label. Short — it renders in a table cell. */
  label: string;
  /** What actually runs on this model, in one line. */
  blurb: string;
  /** `app_settings` key (site scope) or Hermes dotted config key (hermes scope). */
  key: string;
  /**
   * Hermes scope only: the dotted key holding the PROVIDER beside `key`.
   *
   * Hermes reaches Codex through its own native `openai-codex` transport (the
   * Responses API), not through our bridge — and it wants the bare slug, with
   * no `codex/` prefix. So writing a model without writing its provider leaves
   * the engine trying to fetch an OpenAI slug from OpenRouter, which 400s at
   * call time on a path nobody is watching. Always written as a pair.
   */
  providerKey?: string;
  /**
   * The model used when the key is unset.
   *
   * `null` means "follow the site default" — the honest state for a role that
   * has no reason to differ. A string means the code pins something else, and
   * `reason` must say why.
   */
  fallbackModelId: string | null;
  requires: WorkloadRequirement;
  catalogue: WorkloadCatalogue;
  /**
   * Why this role is pinned off the site default, or null if it simply follows
   * it. Rendered inline in the picker: a carve-out the operator can read is a
   * decision; one they can't is a bug waiting to be rediscovered.
   */
  reason: string | null;
}

/**
 * Site-side workloads — each backed by an `app_settings` row and a named
 * resolver in `$lib/server/models/workload-settings`.
 */
export const SITE_WORKLOADS: WorkloadDef[] = [
  {
    id: 'extraction',
    scope: 'site',
    label: 'Entity extraction',
    blurb: 'Intel entity extraction + resolution after a reply lands.',
    key: 'jkai.intel.extract_model',
    fallbackModelId: DEFAULT_EXTRACTION_MODEL_ID,
    requires: 'tools',
    catalogue: 'tools',
    reason:
      'Latency-visible: it runs after the reply is delivered and the entity rail stays empty until it finishes. Mechanical JSON against a fixed schema, so it takes the fastest cheap model rather than the smartest one.',
  },
  {
    id: 'selfimprove',
    scope: 'site',
    label: 'Self-improve',
    blurb: 'The nightly 03:30 self-improvement engine that authors code.',
    key: 'jkai.selfimprove.model',
    fallbackModelId: DEFAULT_SELFIMPROVE_MODEL_ID,
    requires: 'tools',
    catalogue: 'tools',
    reason:
      'Writes code that ships unattended, so it was pinned in 2026-07-29 to stop a chat-default change silently altering what authors it. Still a deliberate choice — just one you can now see and make.',
  },
  {
    id: 'doctor',
    scope: 'site',
    label: 'Workflow doctor',
    blurb: 'The 05:00 workflow doctor that diagnoses failing canvas nodes.',
    key: 'jkai.workflowdoctor.model',
    fallbackModelId: DEFAULT_DOCTOR_MODEL_ID,
    requires: 'tools',
    catalogue: 'tools',
    reason:
      'Pinned for the same reason as self-improve: diagnosis quality should not move overnight because the chat default moved.',
  },
  {
    id: 'thinking',
    scope: 'site',
    label: 'Thinking tier',
    blurb: 'Orchestrator plan / clarify turns and any prompt past the large-context threshold.',
    key: 'jkai.builder.thinking_model',
    fallbackModelId: null,
    requires: 'tools',
    catalogue: 'tools',
    reason: null,
  },
  {
    id: 'vision',
    scope: 'site',
    label: 'Vision / OCR',
    blurb: 'Image captions and OCR for the file index and Drive search.',
    key: 'jkai.vision.model',
    fallbackModelId: DEFAULT_VISION_MODEL_ID,
    requires: 'image-input',
    catalogue: 'tools',
    reason:
      'Must accept images. The site default is currently text-only, and a text-only model answers the prompt while ignoring the picture — a confident caption of nothing.',
  },
  {
    id: 'image',
    scope: 'site',
    label: 'Image generation',
    blurb: 'Studio explainer images (chat-completions with `modalities: [image, text]`).',
    key: 'jkai.image.model',
    fallbackModelId: DEFAULT_IMAGE_MODEL_ID,
    requires: 'image-output',
    catalogue: 'image-out',
    reason:
      "Must emit an image; a text model cannot serve this role at all. Note this does NOT cover the canvas `generate_image` tool, which calls OpenRouter's separate /images/generations endpoint with FLUX — a different API that these models do not serve. That one is set with the JKAI_IMAGE_MODEL env var.",
  },
  {
    id: 'audio',
    scope: 'site',
    label: 'Audio transcription',
    blurb: 'Speech-to-text for audio files in the @files index.',
    key: 'jkai.audio.model',
    fallbackModelId: DEFAULT_AUDIO_MODEL_ID,
    requires: 'audio-input',
    catalogue: 'tools',
    reason:
      "Must accept an `input_audio` content part. OpenAI's whisper endpoint is not reachable through this repo's OpenRouter-only gateway, so transcription rides a multimodal chat model rather than a dedicated speech API.",
  },
  {
    id: 'art-director',
    scope: 'site',
    label: 'Deck art director',
    blurb: 'Composing slide layouts and block choices in the decks builder.',
    key: 'jkai.decks.art_director_model',
    fallbackModelId: DEFAULT_ART_DIRECTOR_MODEL_ID,
    requires: 'tools',
    catalogue: 'tools',
    reason:
      'A one-shot composition, not an agentic loop, so a slower higher-quality model earns its latency here where the agentic roles cannot afford it.',
  },
  {
    id: 'image-tool',
    scope: 'site',
    label: 'Image tool (FLUX)',
    blurb: "The canvas/chat `generate_image` tool — OpenRouter's /images/generations endpoint.",
    key: 'jkai.image.tool_model',
    fallbackModelId: DEFAULT_IMAGE_TOOL_MODEL_ID,
    requires: null,
    // OpenRouter's /models feed does not carry the dedicated image-generation
    // namespace, so there is no list to pick from — the slug is typed in, the
    // same situation as embeddings.
    catalogue: 'none',
    reason:
      'A DIFFERENT API from the `image` role above: /images/generations, which the chat-completions image models do not serve. It was the last LLM spender on the site set only by an environment variable (JKAI_IMAGE_MODEL), i.e. unreadable and unchangeable from any screen.',
  },
  {
    id: 'embeddings',
    scope: 'site',
    label: 'Embeddings',
    blurb: 'RAG, Drive file embeddings and the knowledge index.',
    key: 'jkai.embeddings.model',
    fallbackModelId: DEFAULT_EMBEDDING_MODEL_ID,
    requires: 'embeddings',
    catalogue: 'none',
    reason:
      "Needs the /v1/embeddings endpoint, which Codex has no equivalent of. OpenRouter's model feed omits embedding models, so there is nothing here to pick from a list — set the slug by hand.",
  },
];

/**
 * Hermes engine roles — read and written with `hermes config get|set`, which is
 * the sanctioned path (hand-editing config.yaml round-trips badly: the gateway
 * rewrites key order on restart).
 *
 * These take effect on the next gateway restart, which the save performs.
 */
export const HERMES_WORKLOADS: WorkloadDef[] = [
  {
    id: 'hermes-default',
    scope: 'hermes',
    label: 'Engine default',
    blurb:
      "Every Hermes session the site does not explicitly re-model: WhatsApp DMs, canvas chats, smoke turns. NOT /jkai web chat, which pushes its own model per conversation.",
    key: 'model.default',
    providerKey: 'model.provider',
    fallbackModelId: null,
    requires: 'tools',
    catalogue: 'tools',
    reason: null,
  },
  {
    id: 'hermes-delegation',
    scope: 'hermes',
    label: 'Delegation',
    blurb: 'Child agents Hermes spawns to delegate sub-tasks.',
    key: 'delegation.model',
    providerKey: 'delegation.provider',
    fallbackModelId: null,
    requires: 'tools',
    catalogue: 'tools',
    reason: null,
  },
  {
    id: 'hermes-fallback',
    scope: 'hermes',
    label: 'Engine fallback',
    blurb: 'What Hermes retries on when the primary provider errors.',
    key: 'fallback_model.model',
    providerKey: 'fallback_model.provider',
    fallbackModelId: null,
    requires: 'tools',
    catalogue: 'tools',
    reason:
      'Worth keeping on a DIFFERENT provider from the primary — a fallback that shares the primary\'s outage is not a fallback.',
  },
  {
    id: 'hermes-vision',
    scope: 'hermes',
    label: 'Engine vision',
    blurb: 'Hermes-side image understanding (its own auxiliary model, not the site vision role).',
    key: 'auxiliary.vision.model',
    providerKey: 'auxiliary.vision.provider',
    fallbackModelId: null,
    requires: 'image-input',
    catalogue: 'tools',
    reason: 'Must accept images.',
  },
  {
    id: 'hermes-web-extract',
    scope: 'hermes',
    label: 'Web extract',
    blurb: 'Reading and summarising fetched web pages.',
    key: 'auxiliary.web_extract.model',
    providerKey: 'auxiliary.web_extract.provider',
    fallbackModelId: null,
    requires: null,
    catalogue: 'tools',
    reason: null,
  },
  {
    id: 'hermes-compression',
    scope: 'hermes',
    label: 'Compression',
    blurb: 'Compacting long sessions when the context fills.',
    key: 'auxiliary.compression.model',
    providerKey: 'auxiliary.compression.provider',
    fallbackModelId: null,
    requires: null,
    catalogue: 'tools',
    reason:
      'Runs against very long inputs on a schedule the user never sees — cheap and long-context matters more than reasoning here.',
  },
];

export const WORKLOADS: WorkloadDef[] = [...SITE_WORKLOADS, ...HERMES_WORKLOADS];

export type WorkloadId = string;

export function getWorkload(id: string): WorkloadDef | null {
  return WORKLOADS.find((w) => w.id === id) ?? null;
}

export function isWorkloadId(v: unknown): v is WorkloadId {
  return typeof v === 'string' && WORKLOADS.some((w) => w.id === v);
}

/** Where an effective model came from — drives the source badge in the picker. */
export type WorkloadSource =
  /** An operator set this explicitly. */
  | 'pinned'
  /** No setting; the code fallback in this registry applies. */
  | 'code'
  /** No setting and no code fallback — it follows the site default. */
  | 'default'
  /** Read from Hermes' config.yaml. */
  | 'hermes';

export interface WorkloadState {
  id: string;
  scope: WorkloadScope;
  label: string;
  blurb: string;
  key: string;
  reason: string | null;
  requires: WorkloadRequirement;
  catalogue: WorkloadCatalogue;
  /** What is set explicitly, or null when nothing is. */
  setModelId: string | null;
  /** What will actually answer. */
  effectiveModelId: string;
  source: WorkloadSource;
  /** True when the effective model differs from the site default. */
  divergesFromDefault: boolean;
}

/**
 * True when `modality` says the model emits images.
 *
 * OpenRouter encodes modality as `inputs->outputs`, e.g. `text+image->text+image`.
 * Only the right-hand side matters for generation — plenty of vision models read
 * images and can only write text, and treating those as generators is exactly
 * how you get a text apology where a picture should be.
 */
export function emitsImages(modality: string | null | undefined): boolean {
  if (!modality) return false;
  const arrow = modality.indexOf('->');
  if (arrow === -1) return false;
  return modality.slice(arrow + 2).includes('image');
}
