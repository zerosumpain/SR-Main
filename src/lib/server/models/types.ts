// `ModelProvider` and `ModelContext` moved down to `$lib/constants/model-context`
// so the ambient chat store can carry a model without `$lib/context` and
// `$lib/server` importing each other. Re-exported here because this is where
// most of the codebase already asks for them, and there is no reason to churn
// a hundred import lines for a file move.
export type { ModelProvider, ModelContext } from '$lib/constants/model-context';

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
