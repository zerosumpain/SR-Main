// Shared seam for the two free, on-device AI paths that have no Node
// equivalent: faster-whisper speech-to-text and edge-tts speech synthesis.
//
// Both packages are currently installed only in one venv on this box
// (faster_whisper 1.2.1, edge_tts 7.2.7). That is a convenience, not a
// dependency: `LOCAL_AI_PYTHON` points at whichever interpreter has them, so
// moving the venv later is a config change rather than a code change.
//
// Everything here is best-effort by design. Neither package exists on the VPS,
// so callers MUST treat unavailability as "fall back to the paid API path"
// rather than an error — see extract/audio.ts and
// site-tools/tools/media-generate-audio-tts.ts.
//
// Precedent for shelling out to a host binary from the app: security-posture.ts
// (`sqlite3 -readonly` via execFile). Same shape — execFile with an argv array
// (no shell, so no injection surface), a hard timeout, and a bounded buffer.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';

const execFileP = promisify(execFile);

// NOT the retired gateway. This is a plain Python venv that happens to sit
// under `hermes-agent/` on homeserv, and it is what transcribes /drive audio.
// It survives the gateway's removal because it is a live dependency — but the
// directory it lives in does not, so MOVE THE VENV before deleting that tree,
// or audio ingest silently reports "unavailable" (existsSync fails closed).
// Override with LOCAL_AI_PYTHON once it moves.
const DEFAULT_PYTHON = '/home/john/hermes-agent/venv/bin/python';

export function localPythonBin(): string {
  return process.env.LOCAL_AI_PYTHON || DEFAULT_PYTHON;
}

// Cached per process: the interpreter either exists at boot or it doesn't, and
// this is checked on every /drive audio ingest.
let availability: boolean | null = null;

export function isLocalPythonAvailable(): boolean {
  if (availability === null) availability = existsSync(localPythonBin());
  return availability;
}

/** Test/dev helper — clear the cached existsSync result. */
export function _resetLocalPythonCache(): void {
  availability = null;
}

export interface RunLocalPythonOptions {
  timeoutMs?: number;
  maxBuffer?: number;
}

/**
 * Run the local interpreter with `args`. Resolves with stdout/stderr; rejects
 * on non-zero exit, timeout, or a missing interpreter.
 */
export async function runLocalPython(
  args: string[],
  opts: RunLocalPythonOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  if (!isLocalPythonAvailable()) {
    throw new Error(`local python not available at ${localPythonBin()}`);
  }
  const { stdout, stderr } = await execFileP(localPythonBin(), args, {
    timeout: opts.timeoutMs ?? 120_000,
    maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
  });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
}
