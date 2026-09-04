import JSZip from 'jszip';
import type { ImportInspection } from '../../contracts';
import { ActivitySyncError } from '../../sync/errors';

const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;
const MAX_FILE_COUNT = 5_000;
const MAX_HISTORY_BYTES = 100 * 1024 * 1024;

function safeName(entry: JSZip.JSZipObject): string {
  const unsafe = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
  return unsafe ?? entry.name;
}

function isUnsafeArchivePath(name: string): boolean {
  return name.startsWith('/') || name.startsWith('\\') || name.split(/[\\/]/).includes('..');
}

function isSymbolicLink(entry: JSZip.JSZipObject): boolean {
  return typeof entry.unixPermissions === 'number' &&
    (entry.unixPermissions & 0o170000) === 0o120000;
}

function isWatchHistoryJson(name: string): boolean {
  const normalized = name.replaceAll('\\', '/').toLowerCase();
  return normalized.endsWith('/youtube and youtube music/history/watch-history.json') ||
    normalized.endsWith('/youtube/history/watch-history.json') ||
    normalized.endsWith('/youtube music/history/watch-history.json');
}

async function loadTakeout(bytes: Uint8Array) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new ActivitySyncError('invalid_payload', 'Takeout archive is empty or exceeds 500 MB');
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { createFolders: false });
  } catch {
    throw new ActivitySyncError('invalid_payload', 'Takeout upload is not a valid ZIP archive');
  }
  const entries = Object.values(zip.files);
  if (entries.length > MAX_FILE_COUNT) {
    throw new ActivitySyncError('invalid_payload', 'Takeout archive contains too many files');
  }
  for (const entry of entries) {
    if (isUnsafeArchivePath(safeName(entry))) {
      throw new ActivitySyncError('invalid_payload', 'Takeout archive contains an unsafe path');
    }
    if (isSymbolicLink(entry)) {
      throw new ActivitySyncError('invalid_payload', 'Takeout archive contains a symbolic link');
    }
  }
  const history = entries.filter((entry) => !entry.dir && isWatchHistoryJson(entry.name));
  if (history.length === 0) {
    throw new ActivitySyncError('invalid_payload', 'No JSON YouTube watch history was found');
  }
  return { entries, history };
}

async function readHistory(entry: JSZip.JSZipObject): Promise<{ value: unknown; expandedBytes: number }> {
  const declaredSize = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data
    ?.uncompressedSize;
  if (declaredSize !== undefined && declaredSize > MAX_HISTORY_BYTES) {
    throw new ActivitySyncError('invalid_payload', 'Takeout history exceeds the 100 MB expanded limit');
  }
  const bytes = await entry.async('uint8array');
  if (bytes.byteLength > MAX_HISTORY_BYTES) {
    throw new ActivitySyncError('invalid_payload', 'Takeout history exceeds the 100 MB expanded limit');
  }
  try {
    return {
      value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      expandedBytes: bytes.byteLength,
    };
  } catch {
    throw new ActivitySyncError('invalid_payload', `${entry.name} is not valid UTF-8 JSON`);
  }
}

export async function inspectYouTubeTakeout(bytes: Uint8Array): Promise<
  ImportInspection & { values: unknown[] }
> {
  const { entries, history } = await loadTakeout(bytes);
  const values: unknown[] = [];
  let expandedBytes = 0;
  for (const entry of history) {
    const parsed = await readHistory(entry);
    expandedBytes += parsed.expandedBytes;
    if (expandedBytes > MAX_HISTORY_BYTES) {
      throw new ActivitySyncError(
        'invalid_payload',
        'Takeout history exceeds the 100 MB total expanded limit',
      );
    }
    values.push(parsed.value);
  }
  const estimatedRecords = values.reduce<number>(
    (total, value) => total + (Array.isArray(value) ? value.length : 0),
    0,
  );
  return {
    format: 'google-takeout-youtube-json',
    recognizedFiles: history.map((entry) => entry.name),
    ignoredFiles: entries
      .filter((entry) => !entry.dir && !history.includes(entry))
      .map((entry) => entry.name),
    estimatedRecords,
    expandedBytes,
    warnings: values.some((value) => !Array.isArray(value))
      ? ['At least one watch-history file was not a JSON array.']
      : [],
    values,
  };
}
