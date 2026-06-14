/**
 * Shared display helpers for the research desk + launcher.
 * Salvaged from the retired dashboard/share Svelte pages so the
 * thresholds + colour canon live in one tested place.
 */

export function confidenceColor(c: number): string {
  if (c >= 0.8) return '#2d7d46';
  if (c >= 0.5) return 'var(--accent)';
  return '#8b3a1a';
}

export function confidenceLabel(c: number): string {
  if (c >= 0.8) return 'HIGH';
  if (c >= 0.5) return 'MED';
  return 'LOW';
}

export function credibilityBadge(
  type: string | null | undefined,
): { label: string; color: string } {
  switch (type) {
    case 'academic':
      return { label: 'ACADEMIC', color: '#2d7d46' };
    case 'government':
      return { label: 'GOV', color: '#2d7d46' };
    case 'major_news':
      return { label: 'MAJOR NEWS', color: '#3a6b8b' };
    case 'news':
      return { label: 'NEWS', color: '#3a6b8b' };
    case 'wiki':
      return { label: 'WIKI', color: '#8b7a3a' };
    case 'blog':
      return { label: 'BLOG', color: 'var(--accent)' };
    case 'social':
      return { label: 'SOCIAL', color: '#8b3a1a' };
    default:
      return { label: 'OTHER', color: 'var(--text-muted)' };
  }
}

export function severityColor(severity: string): string {
  if (severity === 'high') return '#8b3a1a';
  if (severity === 'medium') return 'var(--accent)';
  return 'var(--text-muted)';
}

export const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: '#c4570a',
  organisation: '#2d7d46',
  location: '#3a6b8b',
  event: '#7b3a8b',
  concept: '#8b7a3a',
  product: '#3a8b7b',
  other: '#666666',
};

export const SENTIMENT_COLORS: Record<string, string> = {
  positive: '#2d7d46',
  negative: '#8b3a1a',
  neutral: '#999999',
  contested: '#c4570a',
};
