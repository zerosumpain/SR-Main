// Pure email-list helpers, split out from access.ts so they can be unit-tested
// without pulling in $env/dynamic/private or the DB client.

/** Split a comma-separated list into trimmed, lower-cased, non-empty emails. */
export function parseEmailList(raw: string | undefined | null): string[] {
  return (raw || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Case-insensitive membership test used by both the owner and guest gates. */
export function emailInList(email: string | undefined | null, list: string[]): boolean {
  const e = (email || '').trim().toLowerCase();
  return !!e && list.includes(e);
}
