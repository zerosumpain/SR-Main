export const SANDBOX_PROFILES_BASE = '/home/jkai/scraper-profiles';

export function normalizeProfileName(raw: string): string {
  const cleaned = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'default';
}

export function profilePathInSandbox(profile: string): string {
  return `${SANDBOX_PROFILES_BASE}/${normalizeProfileName(profile)}`;
}
