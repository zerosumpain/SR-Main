// src/lib/jkai/extract/audio.ts
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { ExtractError, type ExtractResult, type ExtractOptions } from './types';
import { isLocalSttAvailable, transcribeLocally } from './stt-local';

export async function extractAudio(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  options?: ExtractOptions,
): Promise<ExtractResult> {
  // Free, on-device first (homeserv only). This path used to go straight to
  // OpenRouter for every /drive audio and video ingest — metered spend on the
  // one key whose outage is a total LLM outage. A local failure is not fatal:
  // fall through to the remote path below, which is the previous behaviour
  // unchanged.
  if (isLocalSttAvailable()) {
    try {
      const local = await transcribeLocally(buffer, filename, options?.language);
      if (local.text.trim()) {
        return {
          text: local.text,
          meta: {
            kind: 'audio',
            language: local.language ?? options?.language,
          },
        };
      }
      console.warn('[extract/audio] local STT returned empty text — falling back to remote');
    } catch (err) {
      console.warn(
        '[extract/audio] local STT failed — falling back to remote:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  const modelCtx = await resolveDefaultModel();
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
