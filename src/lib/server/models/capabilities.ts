import type { ModelContext, ModelProvider } from './types';
import { mapLegacyModelId } from '$lib/constants/default-models';
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

export function getModelCapabilities(ctx: ModelContext): ModelCapabilities {
  // Codex serves text only. The SDK does accept images, but as `local_image`
  // with a filesystem PATH — the site passes base64/URLs, so there is no route
  // from an uploaded attachment to a Codex turn without staging it to disk.
  // Claiming image support here would surface a picker option that fails.
  if (ctx.provider === 'codex' || isCodexModelId(ctx.modelId)) return TEXT_ONLY;
  return OPENROUTER_CAPS[mapLegacyModelId(ctx.modelId)] ?? TEXT_ONLY;
}

/**
 * What a PROVIDER can do at the request level, as opposed to what a model can
 * accept as input (ModelCapabilities above).
 *
 * This exists because Codex is an agent runtime wearing an OpenAI-shaped face,
 * not a chat-completions endpoint. Most of the wire format maps cleanly — the
 * Codex SDK has streaming (`runStreamed`), structured output (`outputSchema`,
 * which the bridge maps from `response_format: json_schema`), reasoning effort
 * and real token usage. Two things genuinely do not exist:
 *
 *  - CALLER-SUPPLIED TOOLS. Codex brings its own toolset (shell, file edits,
 *    web search, MCP) and there is no way to hand it your own function schemas
 *    and get tool_calls back. The jkai orchestrator's generation loop depends
 *    on exactly that, so it must stay on OpenRouter.
 *  - EMBEDDINGS. No embedding endpoint at all.
 *
 * The pickers read this to disable Codex options for roles that need those,
 * with the reason shown, rather than letting the pick fail at call time.
 */
export interface ProviderFeatures {
  /** Caller-supplied `tools` / `tool_choice` function schemas. */
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
  tools: false,
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
 * every workflow LLM node with a blank model field. A provider that can't do
 * tools would leave those failing at call time with no obvious cause, so the
 * write is refused at save time instead. Narrower selections (a conversation,
 * a node, a routing profile) know their role and stay free to pick Codex.
 */
export function siteDefaultBlockReason(provider: ModelProvider): string | null {
  if (getProviderFeatures(provider).tools) return null;
  return `${provider} cannot be the site default: it does not support tool-calling, which the orchestrator and builder require. Pick it per-conversation or per-node instead.`;
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
    case 'tools':
      return 'Codex runs its own toolset and cannot accept the function schemas this role passes in. Use an OpenRouter model here.';
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
