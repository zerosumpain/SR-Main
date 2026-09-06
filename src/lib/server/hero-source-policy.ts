/** Only direct children of the named Drive folder can become a public hero. */
export function isHeroSource(file: { name: string; mimeType: string; sizeBytes: number; permissions: unknown }) {
  const permissions = file.permissions as { read?: boolean } | null;
  return /^siteherobackground\/[^/\\]+\.mp4$/i.test(file.name) &&
    !file.name.includes('/../') && !file.name.includes('/./') &&
    file.mimeType.toLowerCase().split(';')[0].trim() === 'video/mp4' &&
    file.sizeBytes > 0 && file.sizeBytes <= 50 * 1024 * 1024 && permissions?.read !== false;
}

export function mediaRange(range: string | null, size: number): { start: number; end: number } | null {
  if (!range) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size
    ? { start, end } : null;
}
