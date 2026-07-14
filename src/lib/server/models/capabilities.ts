import type { ModelContext } from './types';

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

const ZAI_CAPS: Record<string, ModelCapabilities> = {
  'glm-5': ALL,
  'glm-5.2': ALL,
  'glm-5.1': ALL,
  'glm-4.5v': IMAGE_ONLY,
  'glm-4v': IMAGE_ONLY,
  'glm-4.6': TEXT_ONLY,
  'glm-4.5': TEXT_ONLY,
};

const OPENROUTER_CAPS: Record<string, ModelCapabilities> = {
  'anthropic/claude-3.5-sonnet': IMAGE_PDF,
  'anthropic/claude-3.7-sonnet': IMAGE_PDF,
  'anthropic/claude-opus-4.1': IMAGE_PDF,
  'anthropic/claude-sonnet-4.5': IMAGE_PDF,
  'openai/gpt-4o': IMAGE_ONLY,
  'openai/gpt-4.1': IMAGE_ONLY,
  'google/gemini-2.5-pro': ALL,
  'google/gemini-2.5-flash': ALL,
  'x-ai/grok-2-vision': IMAGE_ONLY,
};

export function getModelCapabilities(ctx: ModelContext): ModelCapabilities {
  if (ctx.provider === 'zai') return ZAI_CAPS[ctx.modelId] ?? TEXT_ONLY;
  if (ctx.provider === 'openrouter') return OPENROUTER_CAPS[ctx.modelId] ?? TEXT_ONLY;
  return TEXT_ONLY;
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
