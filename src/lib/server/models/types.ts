export type ModelProvider = 'openrouter';

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
