// Local, free speech-to-text via faster-whisper.
//
// Why: /drive's audio + video ingest sent every file to OpenRouter
// (`whisper-1`), i.e. metered spend on the single key whose outage is a total
// LLM outage. faster-whisper is already installed on homeserv and costs
// nothing, so it becomes the first choice with the paid path kept as fallback
// (extract/audio.ts). Never worse than before: any failure here falls through.
//
// Resolves the .py the same way agent-harness.ts does — import.meta.url first,
// then a cwd-relative path — because the bundled server build flattens chunks
// and loses the source-relative layout.

import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { runLocalPython, isLocalPythonAvailable } from '$lib/jkai/local-python';

const STT_MODEL = process.env.LOCAL_STT_MODEL || 'base';
// Generous: a cold first call downloads the ~150MB model before transcribing.
const STT_TIMEOUT_MS = Number(process.env.LOCAL_STT_TIMEOUT_MS ?? 600_000);

function scriptPath(): string | null {
  try {
    const here = fileURLToPath(new URL('./python/stt.py', import.meta.url));
    if (existsSync(here)) return here;
  } catch {
    /* import.meta.url unavailable in some bundling modes — fall through */
  }
  const rel = join(process.cwd(), 'src/lib/jkai/extract/python/stt.py');
  return existsSync(rel) ? rel : null;
}

export function isLocalSttAvailable(): boolean {
  return isLocalPythonAvailable() && scriptPath() !== null;
}

export interface LocalSttResult {
  text: string;
  language?: string;
  duration?: number;
}

/**
 * Transcribe `buffer` on-device. Throws on any failure — callers are expected
 * to catch and fall back to the remote path rather than surfacing this.
 */
export async function transcribeLocally(
  buffer: Buffer,
  filename: string,
  language?: string,
): Promise<LocalSttResult> {
  const script = scriptPath();
  if (!script) throw new Error('stt.py not found');

  // faster-whisper reads from a path (it hands the file to ffmpeg), so the
  // upload has to land on disk first. Own temp dir per call so concurrent
  // ingests cannot collide on the filename.
  const dir = await mkdtemp(join(tmpdir(), 'jkai-stt-'));
  const ext = (filename.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? '.bin').toLowerCase();
  const audioPath = join(dir, `audio${ext}`);
  await writeFile(audioPath, buffer);

  try {
    const args = [script, audioPath, '--model', STT_MODEL];
    if (language) args.push('--language', language);
    const { stdout } = await runLocalPython(args, { timeoutMs: STT_TIMEOUT_MS });
    const parsed = JSON.parse(stdout) as LocalSttResult;
    if (typeof parsed.text !== 'string') throw new Error('stt.py returned no text');
    return parsed;
  } finally {
    await unlink(audioPath).catch(() => {});
  }
}
