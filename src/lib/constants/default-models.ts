// Site-wide OpenRouter model defaults. All LLM traffic routes through
// OpenRouter — the direct z.ai subscription was decommissioned 2026-07-17.
// GLM models remain available via OpenRouter's z-ai/* slugs (billed to
// OpenRouter). The live defaults are admin-configurable via app_settings
// ('jkai.chat.default_model' etc.); these constants are the code fallbacks.

// Open-weight, 1M context, ~$0.12/1M blended. Chosen 2026-07-25 under John's
// rule: the best model at or below deepseek-v4-flash's price — nothing cheaper
// scores higher on the Artificial Analysis agentic index, so it is the model
// itself. Set from the /jkai picker or /admin/ai/models; this is only the code
// fallback when the DB setting is unset.
export const DEFAULT_CHAT_MODEL_ID = 'deepseek/deepseek-v4-flash';

// One default for every LLM task on the site, including the autonomous builder
// and delegation children (John, 2026-07-25: "the default model should be
// the one any llm task uses across the whole site"). This deliberately retires
// the separate fast-model carve-out that existed because glm-5.2 timed out on
// tool-heavy delegation — see reference_glm52_agentic_slowness for the history,
// and re-split these two constants if agentic timeouts reappear.
export const DEFAULT_AGENTIC_MODEL_ID = DEFAULT_CHAT_MODEL_ID;

// The ONE carve-out from the single-default rule above (John, 2026-07-27).
//
// Entity extraction and resolution are the only LLM calls a user waits on
// without seeing any output: they run after the reply has been delivered, and
// until they finish the reply's entity links and the knowledge-graph rail are
// missing. Measured end-to-end on production that was 20–90s. This is a
// throughput problem, not a reasoning one — the work is mechanical JSON
// extraction against a fixed schema — so it gets the fastest cheap model that
// supports `response_format`, rather than the site default.
//
// gpt-oss-120b: 482 tok/s (the highest recorded in `openrouter_models` among
// JSON-capable models under $1/M output), $0.037/M in vs the chat default's
// $0.14, 131k context, open-weight. Override with the `jkai.intel.extract_model`
// setting; nothing else on the site consults it.
//
// NOTE the throughput figure is last-known: OpenRouter's frontend stats API died
// in 2026-07 and the column carries forward — see reference_openrouter_throughput_source.
export const DEFAULT_EXTRACTION_MODEL_ID = 'openai/gpt-oss-120b';

// ── The remaining workload fallbacks ────────────────────────────────────────
//
// Each of these is the model a role uses when its `app_settings` key is unset.
// They live here, beside the site default, so there is exactly one literal per
// role: `$lib/models/workloads` reads them to render the picker, and the domain
// module that actually makes the call re-exports the same constant. Two copies
// of a model id drift, and a drifted default is invisible until you diff the
// bill (the "four places must agree" problem this file already exists to
// contain).

/** Nightly self-improvement engine. Pinned off the chat default since
 *  2026-07-29: it authors code that ships unattended, so what writes it should
 *  not change because the chat default changed. */
export const DEFAULT_SELFIMPROVE_MODEL_ID = 'deepseek/deepseek-v4-flash';

/** Workflow doctor diagnosis calls — pinned for the same reason. */
export const DEFAULT_DOCTOR_MODEL_ID = 'deepseek/deepseek-v4-flash';

/**
 * Image captioning + OCR. MUST accept image input: the site default may be a
 * Codex model, which is text-only and would caption the prompt, not the file.
 *
 * Was `openai/gpt-4o-mini`, which was wrong twice over. It **refused** to
 * transcribe roughly one document in three ("I'm unable to provide the
 * transcript"), and it is not in `OPENROUTER_CAPS` at all — so
 * `getModelCapabilities()` reported it TEXT_ONLY, meaning the `image-input`
 * guard would have refused to let anyone select it in the picker. It was only
 * ever reachable as this hard-coded default.
 *
 * gemini-2.5-flash is `ALL` in the capability map (so it is selectable),
 * transcribed the same scan cleanly 3 runs out of 3, and was the fastest of the
 * candidates at ~1.2s against ~2.8s for gemini-3.5-flash and ~5.7s for
 * claude-sonnet-4.5. 3.5-flash also started wrapping its output in
 * "==Start of OCR for page 1==" markers, which is not what a transcript is.
 */
export const DEFAULT_VISION_MODEL_ID = 'google/gemini-2.5-flash';

/** Image GENERATION. Must emit an image; no text model can serve this at all. */
export const DEFAULT_IMAGE_MODEL_ID = 'google/gemini-3.1-flash-image';

/**
 * The canvas/chat `generate_image` tool, which calls OpenRouter's
 * /images/generations endpoint rather than chat-completions — a different API
 * that the models above do not serve, and vice versa.
 *
 * Lived in `process.env.JKAI_IMAGE_MODEL` alone until 2026-08-22, which made it
 * the one model on the site that no screen could show you and no screen could
 * change. It is now the `image-tool` workload.
 *
 * A LITERAL, not a `process.env` read: this module is imported by
 * `$lib/models/workloads`, which is deliberately client-importable so the picker
 * renders the same list the server enforces. The env var is still honoured, one
 * layer up in `resolveImageToolModel` where the server actually is.
 */
export const DEFAULT_IMAGE_TOOL_MODEL_ID = 'black-forest-labs/flux-1.1-pro';

/** Embeddings. Always OpenRouter — Codex has no embeddings endpoint. */
export const DEFAULT_EMBEDDING_MODEL_ID = 'openai/text-embedding-3-large';

/** Audio transcription for the @files index. Must accept an `input_audio`
 *  content part — OpenAI's whisper endpoint is not reachable through this
 *  repo's OpenRouter-only gateway, so transcription rides a multimodal chat
 *  model instead. */
export const DEFAULT_AUDIO_MODEL_ID = 'google/gemini-2.0-flash-001';

/** Deck slide art direction. A one-shot composition rather than an agentic
 *  loop, so quality is worth the latency here. */
export const DEFAULT_ART_DIRECTOR_MODEL_ID = 'z-ai/glm-5.2';

// Bare GLM ids from the direct-z.ai era → OpenRouter slugs. Persisted state
// (jkai_conversations/jkai_builds rows, saved workflow node configs, client
// localStorage) can still carry bare ids; coerce instead of 400ing at OpenRouter.
export const LEGACY_GLM_TO_OPENROUTER: Record<string, string> = {
  'glm-5.2': 'z-ai/glm-5.2',
  'glm-5.1': 'z-ai/glm-5.1',
  'glm-5': 'z-ai/glm-5',
  'glm-5-turbo': 'z-ai/glm-5-turbo',
  'glm-5v-turbo': 'z-ai/glm-5v-turbo',
  'glm-4.7': 'z-ai/glm-4.7',
  'glm-4.7-flash': 'z-ai/glm-4.7-flash',
  'glm-4.6': 'z-ai/glm-4.6',
  'glm-4.6v': 'z-ai/glm-4.6v',
  'glm-4.5': 'z-ai/glm-4.5',
  'glm-4.5v': 'z-ai/glm-4.5v',
  'glm-4.5-air': 'z-ai/glm-4.5-air',
};

export function mapLegacyModelId(modelId: string): string {
  return LEGACY_GLM_TO_OPENROUTER[modelId] ?? modelId;
}

/**
 * Coerce any persisted model context into a valid one.
 *
 * Two jobs:
 *  - legacy provider 'zai' + a bare GLM id → an OpenRouter context, and
 *  - preserve a Codex pick rather than flattening it to OpenRouter.
 *
 * That second job is why this function is load-bearing for the Codex provider:
 * EVERY `resolve*Model()` in $lib/server/models/settings runs its stored
 * setting through here, so while this hardcoded `provider: 'openrouter'` a
 * Codex model saved from the picker came back out as an OpenRouter one and was
 * sent to OpenRouter as an unknown slug. Provider is recovered from the
 * `codex/` id prefix, not from the stored `provider` field, because plenty of
 * persisted state (workflow node configs, localStorage, older DB rows) carries
 * a bare model string with no provider at all.
 */
export function coerceModelContext(ctx: { provider?: string; modelId: string }): {
  provider: 'openrouter' | 'codex';
  modelId: string;
} {
  if (ctx.modelId.startsWith('codex/') || ctx.provider === 'codex') {
    // Normalise: a context that says provider 'codex' but carries a bare slug
    // still gets the prefix, so downstream `isCodexModelId` checks agree.
    const modelId = ctx.modelId.startsWith('codex/') ? ctx.modelId : `codex/${ctx.modelId}`;
    return { provider: 'codex', modelId };
  }
  return { provider: 'openrouter', modelId: mapLegacyModelId(ctx.modelId) };
}

/** True for GLM-family models (via OpenRouter). GLM burns reasoning tokens out
 *  of max_tokens, so callers keep generous budgets for these (see
 *  feedback_glm_reasoning_tokens). */
export function isGlmModel(modelId: string): boolean {
  return modelId.startsWith('z-ai/glm') || modelId.startsWith('glm-');
}

/**
 * True for an embedding model.
 *
 * Load-bearing for provider routing rather than cosmetic: Codex is the site's
 * fallback when OpenRouter is unusable, and the bridge has no embeddings
 * endpoint — it translates chat completions and nothing else. So an embedding
 * request must NEVER be re-routed to Codex; it has to fail with OpenRouter's own
 * error, which is at least the true one. Falling back would swap a clear
 * "402 insufficient credits" for a 404 from a bridge that was never asked to do
 * this, and the next person would debug the wrong thing.
 */
export function isEmbeddingModelId(modelId: string): boolean {
  return /(^|\/)text-embedding|embedding/i.test(modelId);
}

/** Minimum max_tokens for a reasoning model. Reasoning tokens are billed and
 *  counted as completion tokens, so a tight budget (some call sites ask for 50)
 *  is consumed entirely by thinking and the caller gets an EMPTY string back. */
export const REASONING_TOKEN_FLOOR = 3000;

/**
 * Default output budget for a canvas LLM node (John, 2026-08-02: "token limit
 * should be 25000").
 *
 * The old per-node defaults (1024/2048) were set before reasoning models were
 * the norm: reasoning tokens are charged against this cap, so a node that asked
 * for 2048 could spend the lot thinking and return an empty string with
 * finish_reason=length. max_tokens is a CEILING, not a spend — a model that
 * wants to answer in 40 tokens still does — so biasing it high costs nothing on
 * the ordinary path and stops the truncation class of failure outright.
 *
 * 76 of the ~340 catalogued OpenRouter models advertise a completion cap below
 * this (lowest ceiling 16384), which is why `withProviderCap` in
 * $lib/jkai/usage-capture clamps the request back down per model.
 */
export const DEFAULT_NODE_MAX_TOKENS = 25_000;

/**
 * True for models that emit reasoning tokens out of the max_tokens budget.
 *
 * Started as a GLM-only quirk (feedback_glm_reasoning_tokens); the same failure
 * appeared with the DeepSeek V4 family when it became the site default on
 * 2026-07-25, so the predicate is now shared. Prefix-matched because vendors
 * ship point releases constantly. Over-matching is cheap — the floor only lifts
 * a cap, it never makes a model generate more than it would.
 */
export function isReasoningModel(modelId: string): boolean {
  // A leading `~` marks an OpenRouter "latest" alias and defeats every
  // startsWith below. 16 prod conversations carry one, and all three
  // `(empty heartbeat reply)` rows in 30 days came from unmatched models —
  // `~deepseek/deepseek-v4-flash-latest`, `moonshotai/kimi-k3` and
  // `tencent/hy3-preview` — each having spent its whole 350-token budget
  // thinking and returned nothing.
  const id = modelId.toLowerCase().replace(/^~/, '');
  return (
    isGlmModel(id) ||
    id.startsWith('deepseek/deepseek-v4') ||
    id.startsWith('deepseek/deepseek-r') ||
    id.startsWith('minimax/minimax-m') ||
    id.startsWith('moonshotai/') ||
    id.startsWith('tencent/hy3') ||
    id.startsWith('qwen/qwq') ||
    id.startsWith('openai/o1') ||
    id.startsWith('openai/o3') ||
    // Codex models reach here as the bare slug — `toCodexSlug` strips the
    // `codex/` prefix long before a request is built, so matching on that
    // prefix would be dead code.
    id.startsWith('gpt-5.') ||
    id.startsWith('openai/gpt-5') ||
    // Gemini 3.x Flash emits reasoning out of the same budget. Measured
    // 2026-08-14 on a research synthesis: 3,251 characters of reasoning against
    // a 421-character answer from a 2,000-token cap — the answer began
    // mid-sentence because thinking had already spent the budget. The family
    // reads like a cheap non-reasoning model and is not one.
    id.startsWith('google/gemini-3')
  );
}
