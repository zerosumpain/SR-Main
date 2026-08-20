import { describe, it, expect, beforeEach } from 'vitest';
import {
  capsFromModalities,
  clearCapabilityCache,
  getModelCapabilities,
  getChatInputCapabilities,
} from './capabilities';

const CODEX = { provider: 'codex', modelId: 'codex/gpt-5.6-terra' } as const;
const TEXT_ONLY_OPENROUTER = { provider: 'openrouter', modelId: 'deepseek/deepseek-v4-flash' } as const;
const MULTIMODAL = { provider: 'openrouter', modelId: 'z-ai/glm-5.1' } as const;

// Capabilities are warmed from the openrouter_models catalogue on first use.
// Dropping the cache before each test keeps these assertions about the STATIC
// fallback deterministic, whatever a test database happens to hold.
beforeEach(() => clearCapabilityCache());

describe('getModelCapabilities', () => {
  it('still reports Codex as text-only — the picker must stay truthful about the model', () => {
    expect(getModelCapabilities(CODEX).image).toBe(false);
  });

  it('reports Codex as unable to take a document either', () => {
    // Verified against the live bridge 2026-08-20: an image comes back "I can't
    // access the image" and a PDF comes back "No document was attached". The
    // model may well see; this transport cannot carry it.
    expect(getModelCapabilities(CODEX).pdf).toBe(false);
  });

  it('falls back to the static map for a model the catalogue has never seen', () => {
    const caps = getModelCapabilities({ provider: 'openrouter', modelId: 'nobody/never-heard-of-it' });
    expect(caps.image).toBe(false);
    expect(caps.documentText).toBe(true);
  });
});

describe('getChatInputCapabilities', () => {
  it('accepts every kind on the Hermes lane, whatever the model says', () => {
    // Hermes owns media handling: an image goes to the model natively when it
    // does vision and through the auxiliary vision model as a description when
    // it doesn't. Gating on the model here is what dropped every image John
    // attached to a Codex conversation before it was ever sent.
    expect(getChatInputCapabilities(CODEX, { hermes: true })).toEqual({
      image: true, audio: true, video: true, pdf: true, documentText: true,
    });
    expect(getChatInputCapabilities(TEXT_ONLY_OPENROUTER, { hermes: true }).image).toBe(true);
  });

  it('falls back to the model when the legacy in-process lane is serving chat', () => {
    // That lane builds the content parts itself, so the model's own limits are
    // the real ones.
    expect(getChatInputCapabilities(CODEX, { hermes: false }).image).toBe(false);
    expect(getChatInputCapabilities(TEXT_ONLY_OPENROUTER, { hermes: false }).image).toBe(false);
    expect(getChatInputCapabilities(MULTIMODAL, { hermes: false }).image).toBe(true);
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
