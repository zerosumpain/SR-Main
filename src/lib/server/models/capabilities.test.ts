import { describe, it, expect, beforeEach } from 'vitest';
import {
  capsFromModalities,
  clearCapabilityCache,
  getModelCapabilities,
  getChatInputCapabilities,
} from './capabilities';

const CODEX = { provider: 'codex', modelId: 'codex/gpt-5.6-terra' } as const;
const TEXT_ONLY_OPENROUTER = { provider: 'openrouter', modelId: 'deepseek/deepseek-v4-flash' } as const;
const MULTIMODAL = { provider: 'openrouter', modelId: 'google/gemini-2.5-flash' } as const;

// Capabilities are warmed from the openrouter_models catalogue on first use.
// Dropping the cache before each test keeps these assertions about the STATIC
// fallback deterministic, whatever a test database happens to hold.
beforeEach(() => clearCapabilityCache());

describe('getModelCapabilities', () => {
  it('reports Codex as reading images and PDFs — the Responses transport carries both', () => {
    // It said text-only until 2026-09-25, so every photo in a Codex chat was
    // replaced by another model's description of it. Measured that day through
    // the bridge's endpoint: an input_image and an input_file PDF both read.
    const caps = getModelCapabilities(CODEX);
    expect(caps.image).toBe(true);
    expect(caps.pdf).toBe(true);
  });

  it('does not claim audio or video for Codex, which the model list does not offer', () => {
    const caps = getModelCapabilities(CODEX);
    expect(caps.audio).toBe(false);
    expect(caps.video).toBe(false);
  });

  it('falls back to the static map for a model the catalogue has never seen', () => {
    const caps = getModelCapabilities({ provider: 'openrouter', modelId: 'nobody/never-heard-of-it' });
    expect(caps.image).toBe(false);
    expect(caps.documentText).toBe(true);
  });
});

describe('getChatInputCapabilities', () => {
  it('allows image, pdf and audio regardless of the model', () => {
    // Chat used to inherit the model's raw limits, which greyed out every
    // attachment on a text-only model. It now pre-analyses anything the model
    // cannot read into text (see $lib/jkai/media/preanalyse), so the composer
    // must not gate them.
    for (const ctx of [CODEX, TEXT_ONLY_OPENROUTER, MULTIMODAL]) {
      const caps = getChatInputCapabilities(ctx);
      expect(caps.image).toBe(true);
      expect(caps.pdf).toBe(true);
      expect(caps.audio).toBe(true);
      expect(caps.documentText).toBe(true);
    }
  });

  it('still gates VIDEO on the model, because nothing can extract text from it', () => {
    expect(getChatInputCapabilities(TEXT_ONLY_OPENROUTER).video).toBe(false);
    expect(getChatInputCapabilities(MULTIMODAL).video).toBe(
      getModelCapabilities(MULTIMODAL).video,
    );
  });
});

describe('capsFromModalities', () => {
  // OpenRouter calls a document content part `file`; we call it `pdf`. Getting
  // that mapping wrong is how a model that reads pictures but not documents
  // ends up chosen to OCR a scanned statement.
  it('maps OpenRouter input modalities onto our capability shape', () => {
    expect(capsFromModalities(['text', 'image', 'file', 'audio', 'video'])).toEqual({
      image: true, audio: true, video: true, pdf: true, documentText: true,
    });
  });

  it('separates image support from document support', () => {
    // minimax-m3 declares exactly this — images and video, no file. It would
    // silently ignore a PDF, which is why the vision pool requires both.
    const caps = capsFromModalities(['text', 'image', 'video']);
    expect(caps.image).toBe(true);
    expect(caps.video).toBe(true);
    expect(caps.pdf).toBe(false);
  });

  it('treats a text-only model as text-only', () => {
    expect(capsFromModalities(['text'])).toEqual({
      image: false, audio: false, video: false, pdf: false, documentText: true,
    });
  });
});
