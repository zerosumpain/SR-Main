import type { ModelContext } from './types';
import { mapLegacyModelId } from '$lib/constants/default-models';

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
  return OPENROUTER_CAPS[mapLegacyModelId(ctx.modelId)] ?? TEXT_ONLY;
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
