// src/lib/jkai/extract/audio.ts
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { ExtractError, type ExtractResult, type ExtractOptions } from './types';

export async function extractAudio(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  options?: ExtractOptions,
): Promise<ExtractResult> {
  const modelCtx = await resolveDefaultModel('builder');
  const { client } = await getLLMClient(modelCtx);

  try {
    const file = new File([new Uint8Array(buffer)], filename || 'audio.bin', { type: mimeType || 'audio/mpeg' });
    const response = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      ...(options?.language ? { language: options.language } : {}),
    });
    const text = response.text ?? '';
    return {
      text,
      meta: {
        kind: 'audio',
        language: options?.language,
      },
    };
  } catch (err) {
    throw new ExtractError('E_TRANSCRIBE_FAILED', 'Whisper transcription failed', err);
  }
}
