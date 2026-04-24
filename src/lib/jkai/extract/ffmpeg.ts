// src/lib/jkai/extract/ffmpeg.ts
import { spawn } from 'child_process';
import { writeFile, readFile, unlink, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ExtractError } from './types';

let ffmpegPath: string | null | undefined;
let ffprobePath: string | null | undefined;

async function which(bin: string): Promise<string | null> {
  return await new Promise((resolve) => {
    const p = spawn('which', [bin]);
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('close', (code) => resolve(code === 0 ? out.trim() : null));
    p.on('error', () => resolve(null));
  });
}

export async function ensureFfmpeg(): Promise<{ ffmpeg: string; ffprobe: string }> {
  if (ffmpegPath === undefined) ffmpegPath = await which('ffmpeg');
  if (ffprobePath === undefined) ffprobePath = await which('ffprobe');
  if (!ffmpegPath || !ffprobePath) {
    throw new ExtractError(
      'E_FFMPEG_MISSING',
      'ffmpeg/ffprobe binary not found on PATH. Install with: apt install ffmpeg',
    );
  }
  return { ffmpeg: ffmpegPath, ffprobe: ffprobePath };
}

export async function probeDurationSec(buffer: Buffer): Promise<number | undefined> {
  const { ffprobe } = await ensureFfmpeg();
  const dir = await mkdtemp(join(tmpdir(), 'extract-probe-'));
  const inPath = join(dir, 'in.bin');
  await writeFile(inPath, buffer);
  try {
    const out = await runProc(ffprobe, ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inPath]);
    const n = parseFloat(out.trim());
    return Number.isFinite(n) ? n : undefined;
  } finally {
    await unlink(inPath).catch(() => {});
  }
}

export async function videoToWav(buffer: Buffer): Promise<Buffer> {
  const { ffmpeg } = await ensureFfmpeg();
  const dir = await mkdtemp(join(tmpdir(), 'extract-vid-'));
  const inPath = join(dir, 'in.bin');
  const outPath = join(dir, 'out.wav');
  await writeFile(inPath, buffer);
  try {
    await runProc(ffmpeg, ['-y', '-i', inPath, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', outPath]);
    return await readFile(outPath);
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

function runProc(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 500)}`));
    });
    p.on('error', reject);
  });
}
