export type ContextSource = 'chat' | 'email' | 'location' | 'weather' | 'calendar' | 'memory';
export type ContextStatus = 'ok' | 'unavailable' | 'failed';

export interface ContextClue {
  source: ContextSource;
  status: ContextStatus;
  /** A distilled, source-safe summary; never a raw message body or coordinates. */
  summary?: string;
  evidenceRef?: string;
  observedAt?: Date;
  /** Optional structured facts from an authorised adapter. */
  data?: Record<string, unknown>;
}

export interface ContextMemoryConfig {
  enabledSources: ContextSource[];
  confidenceThreshold: number;
  maxSuggestionsPerTurn: number;
  quietHours?: { start: number; end: number };
  candidateTtlMs: number;
  resurfacingCooldownMs: number;
}

export const DEFAULT_CONTEXT_MEMORY_CONFIG: ContextMemoryConfig = {
  enabledSources: ['chat', 'email', 'location', 'weather', 'calendar', 'memory'],
  confidenceThreshold: 0.7,
  maxSuggestionsPerTurn: 2,
  candidateTtlMs: 7 * 24 * 60 * 60 * 1000,
  resurfacingCooldownMs: 24 * 60 * 60 * 1000,
};

export interface ContextProposal {
  fingerprint: string;
  kind: 'memory' | 'suggestion';
  text: string;
  category?: 'people' | 'preferences' | 'places' | 'health' | 'devices' | 'situations' | 'patterns';
  confidence: number;
  confirmed: boolean;
  provisional: boolean;
  temporalScope: 'ongoing' | 'today' | 'upcoming';
  provenance: { source: ContextSource; label: string; reference?: string }[];
  expiresAt: Date;
}

export interface ExistingProposal {
  fingerprint: string;
  status: 'pending' | 'accepted' | 'dismissed' | 'deferred';
  updatedAt: Date;
  expiresAt: Date;
}

function fingerprint(kind: ContextProposal['kind'], text: string): string {
  let hash = 5381;
  const normalized = `${kind}:${text.toLowerCase().replace(/\s+/g, ' ').trim()}`;
  for (let i = 0; i < normalized.length; i++) hash = (hash * 33) ^ normalized.charCodeAt(i);
  return `${kind}_${(hash >>> 0).toString(36)}`;
}

function labelFor(clue: ContextClue): string {
  if (clue.source === 'email') return 'from a recent email';
  if (clue.source === 'location') return 'from current location context';
  if (clue.source === 'weather') return 'based on current weather near your location';
  if (clue.source === 'calendar') return 'from your calendar';
  if (clue.source === 'chat') return 'from this conversation';
  return 'from saved memory';
}

function isQuietHour(now: Date, quiet?: ContextMemoryConfig['quietHours']): boolean {
  if (!quiet) return false;
  const hour = now.getHours();
  return quiet.start === quiet.end ? false : quiet.start < quiet.end
    ? hour >= quiet.start && hour < quiet.end
    : hour >= quiet.start || hour < quiet.end;
}

function allowed(proposal: ContextProposal, existing: ExistingProposal[], config: ContextMemoryConfig, now: Date): boolean {
  if (proposal.confidence < config.confidenceThreshold) return false;
  const prior = existing.find((item) => item.fingerprint === proposal.fingerprint);
  if (!prior) return true;
  if (prior.expiresAt <= now) return true;
  if (prior.status === 'dismissed') return false;
  return now.getTime() - prior.updatedAt.getTime() >= config.resurfacingCooldownMs;
}

/**
 * Deterministically turns already-authorised, distilled clues into proposals.
 * It deliberately makes no network calls and has no write side effects, which
 * keeps failed source adapters from becoming invented facts or external actions.
 */
export function deriveContextProposals(
  clues: ContextClue[],
  existing: ExistingProposal[] = [],
  suppliedConfig: Partial<ContextMemoryConfig> = {},
  now = new Date(),
): ContextProposal[] {
  const config = { ...DEFAULT_CONTEXT_MEMORY_CONFIG, ...suppliedConfig };
  if (isQuietHour(now, config.quietHours)) return [];
  const usable = clues.filter((clue) => clue.status === 'ok' && config.enabledSources.includes(clue.source));
  const proposals: ContextProposal[] = [];
  const expiresAt = new Date(now.getTime() + config.candidateTtlMs);
  const provenance = (clue: ContextClue) => [{ source: clue.source, label: labelFor(clue), reference: clue.evidenceRef }];

  for (const clue of usable.filter((item) => item.source === 'chat')) {
    const explicit = clue.summary?.match(/\bI\s+(?:am|have|prefer|need|use|live in)\s+(.{3,140})/i)?.[0];
    if (!explicit) continue;
    const text = explicit.replace(/[.!?].*$/, '').trim();
    proposals.push({
      fingerprint: fingerprint('memory', text), kind: 'memory', text, category: 'situations', confidence: 0.95,
      confirmed: true, provisional: false, temporalScope: 'ongoing', provenance: provenance(clue), expiresAt,
    });
  }

  const location = usable.find((item) => item.source === 'location');
  const weather = usable.find((item) => item.source === 'weather');
  const away = location?.data?.away === true;
  const weatherFactors = Array.isArray(weather?.data?.factors) ? weather?.data?.factors.map(String).join(' ') : weather?.summary ?? '';
  if (away && /rain|fog|gust|wind|snow|ice/i.test(weatherFactors)) {
    const text = 'Conditions may affect your journey — check travel time before you leave.';
    proposals.push({
      fingerprint: fingerprint('suggestion', text), kind: 'suggestion', text, confidence: 0.8,
      confirmed: false, provisional: true, temporalScope: 'today',
      provenance: [
        ...(location ? provenance(location) : []),
        ...(weather ? provenance(weather) : []),
      ], expiresAt,
    });
  }

  for (const clue of usable.filter((item) => item.source === 'email' || item.source === 'calendar')) {
    const subject = String(clue.data?.title ?? clue.summary ?? '').replace(/[\r\n]+/g, ' ').trim();
    if (!subject || !/booking|appointment|reservation|meeting|event|ticket/i.test(subject)) continue;
    const text = 'There may be an upcoming commitment worth checking.';
    proposals.push({
      fingerprint: fingerprint('suggestion', `${text}:${subject}`), kind: 'suggestion', text, confidence: 0.75,
      confirmed: false, provisional: true, temporalScope: 'upcoming', provenance: provenance(clue), expiresAt,
    });
  }

  const retained = proposals.filter((proposal) => allowed(proposal, existing, config, now));
  const memories = retained.filter((proposal) => proposal.kind === 'memory');
  const suggestions = retained.filter((proposal) => proposal.kind === 'suggestion').slice(0, config.maxSuggestionsPerTurn);
  return [...memories, ...suggestions];
}
