import type { ContextLens } from './types';

export interface ContextSignals {
  title?: string | null;
  messages: Array<{ content: string; metadata?: unknown }>;
  graphKinds?: string[];
  graphTypes?: string[];
}
const TERMS: Record<Exclude<ContextLens, 'general'>, RegExp> = {
  intel: /\b(intel|intelligence|entity|entities|relationship|dossier|watchlist|evidence|signal|cluster|knowledge graph)\b/gi,
  research: /\b(research|source|sources|citation|citations|fact check|deep dive|investigat(?:e|ion)|literature|paper|papers|study|studies)\b/gi,
  // Avoid generic words such as "run", "steps", "weight" and "max" here.
  // In a workspace they usually describe code or workflow operations, and one
  // false match is enough to replace the general rail with health metrics.
  health: /\b(health|healthy|sleep|recovery|readiness|hrv|heart rate|rhr|strain|training load|workout|vo2 max|whoop|strava)\b/gi,
  daydream: /\b(daydream|thought|hypothesis|hypotheses|place|places|location|trail|routine|pattern|family movement|where was|where did)\b/gi,
};

function matches(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  return Math.min(6, text.match(pattern)?.length ?? 0);
}

export function classifyContext(signals: ContextSignals) {
  const recent = signals.messages.slice(-6);
  const recentText = recent.map((m) => `${m.content}\n${JSON.stringify(m.metadata ?? {})}`).join('\n');
  const whole = `${signals.title ?? ''}\n${signals.messages.map((m) => m.content).join('\n')}`;
  const raw: Record<ContextLens, number> = { general: 0.18, intel: 0, research: 0, health: 0, daydream: 0 };
  const reasons: Record<ContextLens, string[]> = { general: [], intel: [], research: [], health: [], daydream: [] };

  for (const lens of ['intel', 'research', 'health', 'daydream'] as const) {
    const recentHits = matches(recentText, TERMS[lens]);
    const threadHits = matches(whole, TERMS[lens]);
    raw[lens] += recentHits * 0.18 + threadHits * 0.05;
    if (recentHits) reasons[lens].push(`${recentHits} recent ${lens} signal${recentHits === 1 ? '' : 's'}`);
  }

  const kinds = new Set(signals.graphKinds ?? []);
  const types = (signals.graphTypes ?? []).join(' ').toLowerCase();
  if (kinds.has('intel') || types.includes('intel')) {
    raw.intel += 0.7;
    reasons.intel.push('linked intelligence');
  }
  if (kinds.has('run') || types.includes('research')) {
    raw.research += 0.7;
    reasons.research.push('linked research run');
  }

  const ranked = (Object.keys(raw) as ContextLens[])
    .map((id) => ({
      id,
      score: Math.min(1, Number(raw[id].toFixed(2))),
      reason: reasons[id][0] ?? (id === 'general' ? 'thread overview' : 'no strong signal yet'),
    }))
    .sort((a, b) => b.score - a.score);
  const strongestDomain = ranked.find((lens) => lens.id !== 'general');
  // General is deliberately sticky. A passing mention of a source, entity or
  // daydream should not replace the useful thread overview with a specialist
  // dashboard. Health is the exception: one explicit health signal is useful
  // and sufficiently unambiguous, while the other lenses need either several
  // matching signals or structural evidence from the thread graph.
  const automaticLens = strongestDomain
    && strongestDomain.score >= (strongestDomain.id === 'health' ? 0.22 : 0.65)
      ? strongestDomain.id
      : 'general';
  return { lenses: ranked, automaticLens };
}
