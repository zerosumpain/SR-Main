import type { ModelContext, ModelProvider } from './types';
import { mapLegacyModelId, coerceModelContext } from '$lib/constants/default-models';
import { supportsThinking } from '$lib/models/thinking';
import { eq } from 'drizzle-orm';
import { isCodexModelId } from './codex-catalogue';

export interface ModelCapabilities {
  image: boolean;
  audio: boolean;
  video: boolean;
  pdf: boolean;
  documentText: boolean;
}

const ALL: ModelCapabilities = { image: true, audio: true, video: true, pdf: true, documentText: true };
const IMAGE_ONLY: ModelCapabilities = { image: true, audio: false, video: false, pdf: false, documentText: true };
const IMAGE_PDF: ModelCapabilities = { image: true, audio: false, video: false, pdf: true, documentText: true };
const TEXT_ONLY: ModelCapabilities = { image: false, audio: false, video: false, pdf: false, documentText: true };

// STATIC FALLBACK ONLY — the live catalogue is the source of truth.
//
// This map was hand-maintained and went stale, in both directions: it called
// `minimax/minimax-m3` text-only when it reads images perfectly well, and it
// omitted `openai/gpt-4o-mini` altogether, so that model reported text-only and
// could never be chosen in a picker that gates on image input — even while it
// WAS the hard-coded vision default. A list of 400+ models curated by hand
// against a catalogue that changes weekly cannot stay true.
//
// `warmCatalogueCaps` now derives capabilities from `openrouter_models`, which
// the nightly refresh keeps current. These entries survive only to answer the
// first few calls after boot, and to cover a model the catalogue has dropped.
const OPENROUTER_CAPS: Record<string, ModelCapabilities> = {
  // GLM family via OpenRouter z-ai/* slugs (multimodal parity with the old
  // direct-z.ai capability map).
  'z-ai/glm-5': ALL,
  'z-ai/glm-5.2': ALL,
  'z-ai/glm-5.1': ALL,
  'z-ai/glm-5v-turbo': IMAGE_ONLY,
  'z-ai/glm-4.6v': IMAGE_ONLY,
  'z-ai/glm-4.5v': IMAGE_ONLY,
  'z-ai/glm-4.7': TEXT_ONLY,
  'z-ai/glm-4.6': TEXT_ONLY,
  'z-ai/glm-4.5': TEXT_ONLY,
  'anthropic/claude-3.5-sonnet': IMAGE_PDF,
  'anthropic/claude-3.7-sonnet': IMAGE_PDF,
  'anthropic/claude-opus-4.1': IMAGE_PDF,
  'anthropic/claude-sonnet-4.5': IMAGE_PDF,
  'openai/gpt-4o': IMAGE_ONLY,
  'openai/gpt-4.1': IMAGE_ONLY,
  'google/gemini-2.5-pro': ALL,
  'google/gemini-2.5-flash': ALL,
  'google/gemini-3.5-flash': ALL,
  'google/gemini-3.1-flash-lite-preview': ALL,
  'google/gemini-3.1-flash-lite': ALL,
  'x-ai/grok-2-vision': IMAGE_ONLY,
  // Open-weight cost leaders (the 2026-07-25 routing shift). Listed explicitly
  // even though TEXT_ONLY is the fallback: these are the models the router now
  // picks, so their limits should be stated rather than inferred. deepseek-v4-*
  // and the minimax/tencent picks are all text→text — to send an image or PDF,
  // switch the conversation to a multimodal model in the picker (the alt chip).
  'deepseek/deepseek-v4-flash': TEXT_ONLY,
  'deepseek/deepseek-v4-pro': TEXT_ONLY,
  'minimax/minimax-m3': TEXT_ONLY,
  'tencent/hy3-preview': TEXT_ONLY,
  'openai/gpt-oss-120b': TEXT_ONLY,
};

/**
 * What the CHAT can accept as input, which is not the same question as what the
 * model can accept.
 *
 * `getModelCapabilities` answers "can this model take an image in a content
 * part" — the right question for the model picker, which should stay truthful
 * about the model itself.
 *
 * The chat lane is not that. Images, PDFs and audio are pre-analysed into text
 * when the model cannot read them natively (see `$lib/jkai/media/preanalyse`),
 * so the composer must not grey them out on a text-only model.
 *
 * This mattered in practice: John's chats run on `codex/gpt-5.6-terra`, which
 * maps to TEXT_ONLY, so every image he attached was marked incompatible and
 * dropped from the turn before it was ever sent.
 *
 * Video is NOT included: there is no extraction path for it, so it stays gated
 * on what the model itself accepts.
 */
export function getChatInputCapabilities(ctx: ModelContext): ModelCapabilities {
  const native = getModelCapabilities(ctx);
  return { ...native, image: true, pdf: true, audio: true, documentText: true };
}

/**
 * Capabilities derived from the live OpenRouter catalogue, warmed into memory.
 *
 * Mirrors the pricing warm-up in `$lib/jkai/llm-pricing` deliberately, for the
 * same reason: `getModelCapabilities` is called synchronously from request
 * handlers and pickers, so the load is fire-and-forget and the static map
 * answers until it lands.
 *
 * OpenRouter publishes `architecture.input_modalities` per model — the same
 * field the routing selector filters the vision pool on — so capabilities and
 * routing now agree by construction instead of by hand.
 */
let catalogueCaps: Map<string, ModelCapabilities> | null = null;
let capsWarmInFlight = false;

/** `input_modalities` → our capability shape. `file` is OpenRouter's name for
 *  "accepts a document (PDF) as a content part", which is our `pdf`. */
export function capsFromModalities(inputs: string[]): ModelCapabilities {
  return {
    image: inputs.includes('image'),
    audio: inputs.includes('audio'),
    video: inputs.includes('video'),
    pdf: inputs.includes('file'),
    // Every chat model takes text; nothing in the catalogue contradicts it.
    documentText: true,
  };
}

function warmCatalogueCaps(): void {
  if (catalogueCaps || capsWarmInFlight) return;
  capsWarmInFlight = true;
  (async () => {
    const { db } = await import('$lib/db');
    const { openrouterModels } = await import('$lib/db/schema');
    const rows = await db
      .select({ id: openrouterModels.id, raw: openrouterModels.raw })
      .from(openrouterModels);
    const map = new Map<string, ModelCapabilities>();
    for (const r of rows) {
      const raw = (r.raw ?? {}) as { architecture?: { input_modalities?: unknown } };
      const inputs = raw.architecture?.input_modalities;
      // No modality data is not the same as "text only" — skip the row and let
      // the static map answer, rather than asserting a capability we never read.
      if (!Array.isArray(inputs) || inputs.length === 0) continue;
      map.set(r.id, capsFromModalities(inputs.map((m) => String(m))));
    }
    if (map.size > 0) catalogueCaps = map;
  })().catch(() => {
    // DB unavailable — stay on the static fallback; retry on a later call.
    capsWarmInFlight = false;
  });
}

/** Test/refresh hook: drop the warmed catalogue map. Called by the nightly
 *  catalogue refresh so a new snapshot takes effect without a restart. */
export function clearCapabilityCache(): void {
  catalogueCaps = null;
  capsWarmInFlight = false;
}

export function getModelCapabilities(ctx: ModelContext): ModelCapabilities {
  // Codex serves text only THROUGH THIS GATEWAY. The SDK does accept images,
  // but as `local_image` with a filesystem PATH — the site passes base64/URLs,
  // so there is no route from an uploaded attachment to a Codex turn without
  // staging it to disk. Verified 2026-08-20: sent an image and a PDF to
  // codex/gpt-5.6-terra through getLLMClient and it answered "I can't access
  // the image" / "No document was attached". Claiming support here would
  // surface a picker option that fails. (Chat is different — it stages the
  // bytes itself; see getChatInputCapabilities.)
  if (ctx.provider === 'codex' || isCodexModelId(ctx.modelId)) return TEXT_ONLY;
  warmCatalogueCaps();
  const id = mapLegacyModelId(ctx.modelId);
  return catalogueCaps?.get(id) ?? OPENROUTER_CAPS[id] ?? TEXT_ONLY;
}

/**
 * Whether this model will do anything with a thinking level — the gate on the
 * composer's thinking chip.
 *
 * Async and un-cached, unlike the modality capabilities above, because it is
 * asked once per thread open rather than inside a render: a primary-key lookup
 * against `openrouter_models` is cheaper than another warmed map to invalidate,
 * and it cannot go stale between the nightly refresh and a restart.
 *
 * Codex never touches the catalogue — it has no row there, and every Codex
 * model reasons (see codex-catalogue).
 */
export async function modelSupportsThinking(ctx: ModelContext): Promise<boolean> {
  const resolved = coerceModelContext(ctx);
  if (resolved.provider === 'codex') return true;
  try {
    const { db } = await import('$lib/db');
    const { openrouterModels } = await import('$lib/db/schema');
    const [row] = await db
      .select({ raw: openrouterModels.raw })
      .from(openrouterModels)
      .where(eq(openrouterModels.id, mapLegacyModelId(resolved.modelId)))
      .limit(1);
    return supportsThinking(resolved.provider, row?.raw ?? null);
  } catch {
    // No catalogue, no claim. Hiding the chip is the safe failure: the thread
    // keeps whatever level it already had, and it comes back on the next load.
    return false;
  }
}

/**
 * What a PROVIDER can do at the request level, as opposed to what a model can
 * accept as input (ModelCapabilities above).
 *
 * Codex is an agent runtime wearing an OpenAI-shaped face, so the mapping is
 * not one-for-one — but almost all of it works: streaming, structured output
 * (`outputSchema` from `response_format: json_schema`), reasoning effort, real
 * token usage, and — since the bridge learned to publish caller tools as an
 * MCP server — full tool-calling.
 *
 * The one genuine gap left is EMBEDDINGS: Codex has no embedding endpoint, so
 * those paths stay on OpenRouter.
 *
 * The pickers read this to disable options for roles a provider cannot serve,
 * with the reason shown, rather than letting the pick fail at call time.
 */
export interface ProviderFeatures {
  /**
   * Whether this transport can forward caller-supplied `tools` / `tool_choice`
   * function schemas and return `tool_calls`.
   *
   * True for both providers. It briefly read false for Codex because the SDK
   * has no `tools` field — but that was a limit of how the bridge drove Codex,
   * not of Codex, and stating it here made the UI tell users something untrue
   * about GPT-5.6. The bridge now publishes caller tools over MCP, which is the
   * supported way in, so the flag reflects the model again.
   */
  tools: boolean;
  /** `response_format` with a JSON schema. */
  structuredOutput: boolean;
  /** Token-by-token streaming. */
  streaming: boolean;
  /** The /v1/embeddings endpoint. */
  embeddings: boolean;
}

const OPENROUTER_FEATURES: ProviderFeatures = {
  tools: true,
  structuredOutput: true,
  streaming: true,
  embeddings: true,
};

const CODEX_FEATURES: ProviderFeatures = {
  // TRUE since the bridge learned to publish caller tools as an MCP server —
  // the only route by which Codex accepts external tools. It captures the
  // dispatch and returns `tool_calls`, so the caller still runs the tool, as
  // the chat-completions contract requires. Before that this said false, and
  // the UI wrongly reported the MODEL as incapable.
  tools: true,
  structuredOutput: true,
  streaming: true,
  embeddings: false,
};

export function getProviderFeatures(provider: ModelProvider): ProviderFeatures {
  return provider === 'codex' ? CODEX_FEATURES : OPENROUTER_FEATURES;
}

/**
 * Why a provider can't be the SITE DEFAULT, or null if it can.
 *
 * The site default is the one model every unpinned role falls back to —
 * including the orchestrator's tool-calling loop, the autonomous builder and
 * every workflow LLM node with a blank model field. A provider that cannot pass
 * tool schemas would leave those failing at call time with no obvious cause, so
 * the write is refused at save time instead.
 *
 * BOTH providers now pass this: Codex gained tool-calling when the bridge
 * started publishing caller tools over MCP, so Codex is a legitimate site
 * default. The guard stays because the property it checks is real and the next
 * provider may not have it — not as a Codex carve-out.
 *
 * Note this is a capability gate, not a judgement about speed. A Codex site
 * default is materially slower per tool call than OpenRouter (a fresh Codex
 * process per turn); that is a cost trade the operator is entitled to make, and
 * the picker says so rather than deciding for them.
 */
export function siteDefaultBlockReason(provider: ModelProvider): string | null {
  if (getProviderFeatures(provider).tools) return null;
  return `${provider} cannot be the site default: this transport cannot pass tool schemas, which the orchestrator and builder require.`;
}

/** Human-readable reason a provider can't serve a role, or null if it can.
 *  Rendered as the disabled-option tooltip in the model pickers. */
export function unsupportedReason(
  provider: ModelProvider,
  need: keyof ProviderFeatures,
): string | null {
  if (getProviderFeatures(provider)[need]) return null;
  if (provider !== 'codex') return `This provider does not support ${need}.`;
  switch (need) {
    case 'embeddings':
      return 'Codex has no embeddings endpoint. Use an OpenRouter model here.';
    default:
      return `Codex does not support ${need}.`;
  }
}

export function canAcceptKind(caps: ModelCapabilities, kind: string): boolean {
  switch (kind) {
    case 'image': return caps.image;
    case 'audio': return caps.audio;
    case 'video': return caps.video;
    case 'pdf':   return caps.pdf;
    case 'document':
    case 'text':  return caps.documentText;
    default: return false;
  }
}
