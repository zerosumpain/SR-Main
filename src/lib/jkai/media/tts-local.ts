// Free, key-free speech synthesis via edge-tts (Microsoft neural voices).
//
// Why: generate_audio_tts was ElevenLabs-only and returned a hard
// "ElevenLabs API key not configured" when the key was absent — and that key
// lives in keys.json, which is gitignored and NOT in the gpg escrow (the Tavily
// key has already been lost that way once). This turns that hard failure into
// working audio at no cost. ElevenLabs stays primary when its key is present,
// so existing output quality is unchanged.

import { mkdtemp, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLocalPython, isLocalPythonAvailable } from '$lib/jkai/local-python';

// Matches the voice already configured for Hermes' own TTS
// (~/.hermes-jkai/config.yaml → tts.voice), so spoken output sounds the same
// whichever path produced it.
const EDGE_VOICE = process.env.LOCAL_TTS_VOICE || 'en-US-AriaNeural';
const EDGE_TIMEOUT_MS = Number(process.env.LOCAL_TTS_TIMEOUT_MS ?? 120_000);

export function isLocalTtsAvailable(): boolean {
  return isLocalPythonAvailable();
}

/**
 * Synthesise `text` to MP3 bytes. Throws on any failure — the caller decides
 * whether that is fatal.
 */
export async function synthesizeLocally(text: string, voice?: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'jkai-tts-'));
  const out = join(dir, 'speech.mp3');
  try {
    // argv array, no shell — `text` is never interpolated into a command line.
    await runLocalPython(
      ['-m', 'edge_tts', '--text', text, '--voice', voice || EDGE_VOICE, '--write-media', out],
      { timeoutMs: EDGE_TIMEOUT_MS },
    );
    const buf = await readFile(out);
    if (buf.byteLength === 0) throw new Error('edge-tts produced an empty file');
    return buf;
  } finally {
    await unlink(out).catch(() => {});
  }
}
