import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { inspectYouTubeTakeout } from './archive.server';

async function archive(path: string, value: unknown): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(path, JSON.stringify(value));
  return zip.generateAsync({ type: 'uint8array' });
}

describe('YouTube Takeout archive inspection', () => {
  it('finds the documented JSON history path without parsing unrelated files', async () => {
    const zip = new JSZip();
    zip.file('Takeout/YouTube and YouTube Music/history/watch-history.json', JSON.stringify([{ title: 'Watched x', time: '2026-01-01T00:00:00Z' }]));
    zip.file('Takeout/YouTube and YouTube Music/playlists/likes.csv', 'private,ignored');
    const result = await inspectYouTubeTakeout(await zip.generateAsync({ type: 'uint8array' }));
    expect(result.format).toBe('google-takeout-youtube-json');
    expect(result.estimatedRecords).toBe(1);
    expect(result.recognizedFiles).toHaveLength(1);
    expect(result.ignoredFiles).toHaveLength(1);
  });

  it('rejects a zip without a supported history file', async () => {
    await expect(inspectYouTubeTakeout(await archive('Takeout/readme.txt', []))).rejects.toThrow(/No JSON/);
  });
});
