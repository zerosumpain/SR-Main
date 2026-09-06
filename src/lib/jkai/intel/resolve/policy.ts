import { scorePair, normaliseName, differsOnlyByNumber, emailOf, type ResolvableEntity, type ScoreOptions } from './match';

export const RESOLUTION_VERSION = 'evidence-v1';
export interface IdentityDecision {
  verdict: string; decidedBy: string; verdictConfidence?: number | null;
  evidenceVersion?: string | null; citations?: string[];
}
export interface IdentityAssessment { score: number; canLink: boolean; reason: string; signals: string[] }

/** Shared identity policy. Similarity is evidence for review, never identity by itself. */
export function assessIdentity(a: ResolvableEntity, b: ResolvableEntity, opts: ScoreOptions = {}, decision?: IdentityDecision | null): IdentityAssessment {
  const match = scorePair(a, b, opts);
  const result = { score: match?.confidence ?? 0, canLink: false, reason: match?.reason ?? 'No independent identity evidence', signals: match?.signals ?? [] };
  if (decision?.decidedBy === 'human') {
    if (decision.verdict === 'different') return { ...result, score: 0, reason: 'A human recorded these as different entities' };
    if (decision.verdict === 'same') return { ...result, score: 1, canLink: true, reason: 'Human-confirmed identity' };
  }
  const ea = emailOf(a, opts.addressIdentities), eb = emailOf(b, opts.addressIdentities);
  if (ea && eb && ea !== eb) return { ...result, reason: 'Conflicting addresses require explicit identity evidence' };
  if (differsOnlyByNumber(a.name, b.name)) return { ...result, reason: 'Different numbered members require review' };
  if (a.typeId !== b.typeId && !result.signals.includes('same_email')) return { ...result, reason: 'Different types require review before linking' };
  if (decision?.verdict === 'different') return { ...result, score: 0.2, reason: 'Evidence adjudication found different entities' };
  const groundedSame = decision?.verdict === 'same' && (decision.verdictConfidence ?? 0) >= 0.95 && (decision.citations?.length ?? 0) > 0;
  const person = /person|people/i.test(a.typeName) || /person|people/i.test(b.typeName);
  if (person && !result.signals.includes('same_email') && !groundedSame) return { ...result, score: Math.min(result.score,0.84), reason: 'A person’s name alone does not establish identity' };
  const strong = result.signals.some(s => ['same_email', 'identical_name', 'canonical_name', 'alias_match'].includes(s));
  return { ...result, score: groundedSame ? Math.max(0.9, result.score) : strong ? result.score : Math.min(result.score,0.84),
    canLink: Boolean(groundedSame || (strong && result.score >= 0.85)),
    reason: groundedSame ? 'Cited source evidence establishes identity' : result.reason };
}

export function chooseIdentity(candidates: Array<{ entity: ResolvableEntity; assessment: IdentityAssessment }>) {
  const ranked = [...candidates].sort((a, b) => b.assessment.score - a.assessment.score || a.entity.id.localeCompare(b.entity.id));
  const eligible = ranked.filter(c => c.assessment.canLink);
  if (eligible.length === 1 && !ranked.some(c => c !== eligible[0] && c.assessment.score >= eligible[0].assessment.score - 0.08)) {
    return { outcome: 'link' as const, entity: eligible[0].entity, reason: eligible[0].assessment.reason, ranked };
  }
  return { outcome: ranked.some(c => c.assessment.score >= 0.35) ? 'unresolved' as const : 'new' as const,
    entity: null, reason: eligible.length > 1 ? 'Multiple plausible identities' : ranked[0]?.assessment.reason ?? 'No matching entity', ranked };
}

/** A literal source span can be verified even when the model normalises the display name. */
export function groundMention(text: string, name: string, mention?: { text: string; start?: number; end?: number }) {
  const surface = mention?.text || name;
  let start = mention?.start;
  if (start === undefined || text.slice(start, start + surface.length) !== surface) {
    start = text.toLowerCase().indexOf(surface.toLowerCase());
  }
  if (start < 0 || !normaliseName(surface)) return null;
  const end = start + surface.length;
  return { surface: text.slice(start, end), start, end, excerpt: text.slice(Math.max(0, start - 160), Math.min(text.length, end + 200)) };
}
