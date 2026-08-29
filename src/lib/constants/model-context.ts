/**
 * Which model, and on whose bill — the two-field shape that every model-aware
 * call site passes around.
 *
 * Lives in `constants` (foundation) rather than in `$lib/server/models/types`
 * because the ambient chat store in `$lib/context` now carries a model, and both
 * of those are `platform`: a type-only import between them is still an import,
 * and the boundary gate reads it as the two modules depending on each other.
 * Moving the shape DOWN is the gate's own first-choice fix, and it costs
 * nothing — `$lib/server/models/types` re-exports both names, so every existing
 * import of them still resolves.
 */

/**
 * `openrouter` — per-token, billed to the OpenRouter key. The default for
 * everything.
 * `codex` — served by the local Codex bridge sidecar against John's ChatGPT
 * Pro subscription (packages/jkai-codex-bridge). Zero marginal cost, finite
 * quota, and a narrower feature set — see $lib/server/models/codex-catalogue
 * and getProviderFeatures() in $lib/server/models/capabilities.
 */
export type ModelProvider = 'openrouter' | 'codex';

export interface ModelContext {
  provider: ModelProvider;
  modelId: string;
}
