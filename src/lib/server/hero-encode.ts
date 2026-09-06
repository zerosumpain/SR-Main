import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const exec = promisify(execFile);
const options = { timeout: 180_000, maxBuffer: 1024 * 1024 };

export async function requireHeroEncoder() {
  try {
    await exec('ffmpeg', ['-version'], options);
    await exec('ffprobe', ['-version'], options);
  } catch { throw new Error('Video preparation is unavailable. Install FFmpeg on the server, then try again.'); }
}

/** Decode only local MP4 bytes, with bounded duration, dimensions and CPU use. */
export async function encodeHero(source: string, directory: string) {
  let metadata;
  try {
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'mov',
      '-show_format', '-show_streams', '-of', 'json', source], options);
    metadata = JSON.parse(stdout);
  } catch { throw new Error('This file could not be read as an MP4 video.'); }
  const duration = Number(metadata.format?.duration);
  const video = metadata.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60 || !video ||
      !(video.width > 0 && video.width <= 4096 && video.height > 0 && video.height <= 4096)) {
    throw new Error('Choose an MP4 up to 60 seconds long and no larger than 4096 pixels on either side.');
  }
  const outputs: Record<string, Buffer> = {};
  for (const [kind, width, budget] of [['desktop', 960, 2_000_000], ['mobile', 480, 1_000_000]] as const) {
    const output = join(directory, `${kind}.mp4`);
    const rate = Math.floor(budget * 8 * 0.85 / duration);
    await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-protocol_whitelist', 'file,pipe',
      '-threads', '2', '-f', 'mov', '-i', source, '-map', '0:v:0', '-t', '60', '-an', '-sn', '-dn', '-map_metadata', '-1',
      '-filter_threads', '2', '-vf', `scale=w=min(${width}\\,iw):h=min(${width}\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2,fps=24`,
      '-c:v', 'libx264', '-threads', '2', '-preset', 'medium', '-crf', '30', '-maxrate', String(rate), '-bufsize', String(rate * 2),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], options);
    if ((await stat(output)).size > budget) throw new Error('The prepared video is too large. Choose a shorter MP4.');
    outputs[kind] = await readFile(output);
  }
  const desktop = join(directory, 'desktop.mp4');
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', desktop], options);
  const frames = Number(JSON.parse(stdout).streams[0].nb_frames);
  const poster = join(directory, 'poster.webp');
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', '-i', desktop,
    '-vf', `select=eq(n\\,${frames - 1})`, '-frames:v', '1', '-quality', '70', poster], options);
  outputs.poster = await readFile(poster);
  return { duration, outputs };
}
