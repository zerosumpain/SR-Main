// src/lib/jkai/extract/video.ts
import { extractAudio } from './audio';
import { videoToWav, probeDurationSec } from './ffmpeg';
import { ExtractError, type ExtractResult, type ExtractOptions, MAX_VIDEO_DURATION_SEC } from './types';

export async function extractVideo(
  buffer: Buffer,
  _mimeType: string,
  filename: string,
  options?: ExtractOptions,
): Promise<ExtractResult> {
  const duration = await probeDurationSec(buffer).catch(() => undefined);
  if (duration && duration > MAX_VIDEO_DURATION_SEC) {
    throw new ExtractError(
      'E_SOURCE_TOO_LARGE',
      `video is ${Math.round(duration)}s; max ${MAX_VIDEO_DURATION_SEC}s for v1`,
    );
  }

  const wav = await videoToWav(buffer);
  const audio = await extractAudio(wav, 'audio/wav', (filename || 'video') + '.wav', options);

  return {
    text: audio.text,
    meta: {
      kind: 'video',
      durationSec: duration,
      language: options?.language,
    },
  };
}
