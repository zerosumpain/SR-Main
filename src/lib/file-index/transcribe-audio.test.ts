import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  transcribe: vi.fn(),
  chat: vi.fn(),
}));

vi.mock('$lib/llm/client', () => ({
  getLLMClient: async () => ({
    client: { audio: { transcriptions: { create: h.transcribe } }, chat: { completions: { create: h.chat } } },
    model: 'google/gemini-2.0-flash-001',
  }),
}));
vi.mock('$lib/server/models/settings', () => ({ resolveDefaultModel: vi.fn() }));
vi.mock('$lib/server/models/capabilities', () => ({ getModelCapabilities: vi.fn() }));
vi.mock('$lib/server/models/workload-settings', () => ({
  resolveVisionModel: vi.fn(),
  resolveAudioModel: async () => ({ provider: 'openrouter', modelId: 'google/gemini-2.0-flash-001' }),
}));
vi.mock('$lib/context/activity', () => ({ withActivity: (_k: string, fn: () => unknown) => fn() }));

const { transcribeAudioBestEffort } = await import('./describe');

describe('transcribeAudioBestEffort', () => {
  beforeEach(() => {
    h.transcribe.mockReset();
    h.chat.mockReset();
  });

  it('uses speech-to-text (whisper-1), never a chat model', async () => {
    h.transcribe.mockResolvedValue({ text: ' Remind me to book the car in on Monday. ' });
    const text = await transcribeAudioBestEffort(Buffer.from([1, 2, 3]), 'audio/mp4');
    expect(text).toBe('Remind me to book the car in on Monday.');
    expect(h.chat).not.toHaveBeenCalled();
    const arg = h.transcribe.mock.calls[0][0] as { model: string; file: File };
    expect(arg.model).toBe('whisper-1');
    expect(arg.file.name).toBe('audio.m4a');
    expect(arg.file.type).toBe('audio/mp4');
  });

  it('is null on a failure, silence, an unknown format or an oversized file', async () => {
    h.transcribe.mockRejectedValueOnce(new Error('401'));
    expect(await transcribeAudioBestEffort(Buffer.from([1]), 'audio/mpeg')).toBeNull();
    h.transcribe.mockResolvedValueOnce({ text: '   ' });
    expect(await transcribeAudioBestEffort(Buffer.from([1]), 'audio/wav')).toBeNull();
    expect(await transcribeAudioBestEffort(Buffer.from([1]), 'audio/x-unknown')).toBeNull();
    expect(await transcribeAudioBestEffort(Buffer.alloc(21 * 1024 * 1024), 'audio/mp4')).toBeNull();
    expect(h.transcribe).toHaveBeenCalledTimes(2);
  });
});
