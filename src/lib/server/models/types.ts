/**
 * `openrouter` — per-token, billed to the OpenRouter key. The default for
 * everything.
 * `codex` — served by the local Codex bridge sidecar against John's ChatGPT
 * Pro subscription (packages/jkai-codex-bridge). Zero marginal cost, finite
 * quota, and a narrower feature set — see $lib/server/models/codex-catalogue
 * and getProviderFeatures() in ./capabilities.
 */
export type ModelProvider = 'openrouter' | 'codex';

export interface ModelContext {
  provider: ModelProvider;
  modelId: string;
}

export interface PriceSnapshot {
  promptPrice: number; // USD per token
  completionPrice: number;
  imagePerImageUsd?: number;
  ttsPerCharUsd?: number;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface UsageDelta extends Usage {
  costUsd: number;
}
