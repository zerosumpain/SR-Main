import { assessIdentity } from '$lib/jkai/intel/resolve/policy';
import { PERSONA_TRAITS, TRAIT_LABELS, type Artefact, type TraitKey } from './contracts';

export { PERSONA_TRAITS, TRAIT_LABELS, type TraitKey };

/**
 * The persona library — a body the reader keeps meeting, remembered between
 * assessments.
 *
 * Everything here is pure and testable without a database. The store in
 * `server/personas.ts` reads and writes rows; this module decides what a persona
 * IS, which actor is which persona, and what a prior may say to a running
 * assessment.
 *
 * The whole design turns on one distinction. A persona is CONTEXT, never
 * evidence: it was drawn from other papers about other policies, and importing
 * its conclusions into this assessment would be the opposite of a red team. The
 * provenance rules already enforce that — nothing carrying `prior_assessment`
 * can reach a passage or a retrieved source, so `hasSource` keeps it out of the
 * findings on its own account — and the prompt says it in words as well.
 */

export type PersonaTrait = { key: string; label: string; value: string; origin: string; confidence: number | null };

export type PersonaRecord = {
  id: string;
  name: string;
  entityType: string;
  aliases: string[];
  summary: string | null;
  dossier: PersonaTrait[];
  sightings: number;
  researchedAt: string | null;
  updatedAt: string | null;
};

/** One assessment's or one research pass's contribution to a persona. */
export type PersonaObservation = {
  id: string;
  personaId: string;
  kind: 'assessment' | 'research';
  analysisId: string | null;
  analysisTitle: string | null;
  actorId: string | null;
  traits: PersonaTrait[];
  plays: { label: string; band: string; exposure: number; legality: string }[];
  sources: { url: string; title: string; quality: string }[];
  note: string | null;
  observedAt: string | null;
};

/** What a running stage is shown about a body it has met before. */
export type PersonaPrior = {
  actorId: string;
  personaId: string;
  name: string;
  entityType: string;
  sightings: number;
  summary: string | null;
  traits: PersonaTrait[];
  /** The plays this body was shown capable of in OTHER assessments, worst first. */
  trackRecord: { label: string; band: string; exposure: number; legality: string; policy: string | null }[];
  /** How the match was made, so the model can discount a weak one. */
  basis: string;
};

const clean = (v: unknown, max = 600): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A resolvable entity in the shape the site's identity policy expects. */
function resolvable(id: string, name: string, type: string, aliases: string[]) {
  return { id, name, typeId: type, typeName: type, degree: 0, noteCount: 1, aliases };
}

/**
 * Which persona, if any, this actor already is.
 *
 * `assessIdentity` is the site's own identity policy — the one entity
 * resolution and cross-policy exposure already use — and it is deliberately
 * conservative: a shared name is not a shared body, and two different entity
 * types do not link without independent evidence. An unresolved match opens a
 * NEW persona rather than merging two, because a wrongly merged dossier would
 * quietly contaminate every future assessment that reads it and there would be
 * nothing on the page to show it had happened.
 */
export function matchPersona(
  actor: { id: string; label: string; entityType: string; aliases: string[] },
  candidates: PersonaRecord[],
): { persona: PersonaRecord; basis: string } | null {
  const mine = resolvable(actor.id, actor.label, actor.entityType, actor.aliases);
  const scored = candidates
    .map((persona) => ({ persona, assessment: assessIdentity(mine, resolvable(persona.id, persona.name, persona.entityType, persona.aliases)) }))
    .filter((c) => c.assessment.canLink)
    .sort((a, b) => b.assessment.score - a.assessment.score || a.persona.id.localeCompare(b.persona.id));
  if (!scored.length) return null;
  // Two personas the policy cannot separate is exactly the ambiguity the entity
  // stage preserves rather than resolves. Open a new one and let the reader merge.
  if (scored.length > 1 && scored[1].assessment.score >= scored[0].assessment.score - 0.08) return null;
  return { persona: scored[0].persona, basis: scored[0].assessment.reason };
}

/**
 * Bound a prior to what a stage can actually use.
 *
 * The context budget sheds by kind and a prior is not an artefact, so it rides
 * the payload uncapped unless something caps it. Twelve traits at 600 characters
 * plus six plays is about 9,000 characters for an actor — affordable once per
 * fan-out unit, and the fan-out is one actor at a time.
 */
export const PRIOR_TRAITS = 12;
export const PRIOR_PLAYS = 6;

export function personaPrior(
  actorId: string,
  match: { persona: PersonaRecord; basis: string },
  observations: PersonaObservation[],
  excludeAnalysisId: string | null = null,
): PersonaPrior {
  const { persona, basis } = match;
  const trackRecord = observations
    .filter((o) => o.personaId === persona.id && o.analysisId !== excludeAnalysisId)
    .flatMap((o) => o.plays.map((p) => ({ ...p, policy: o.analysisTitle })))
    .sort((a, b) => b.exposure - a.exposure)
    .slice(0, PRIOR_PLAYS)
    .map((p) => ({ label: clean(p.label, 200), band: clean(p.band, 40), exposure: Number(p.exposure) || 0, legality: clean(p.legality, 40), policy: p.policy ? clean(p.policy, 120) : null }));
  return {
    actorId,
    personaId: persona.id,
    name: persona.name,
    entityType: persona.entityType,
    sightings: persona.sightings,
    summary: persona.summary ? clean(persona.summary, 900) : null,
    traits: persona.dossier.slice(0, PRIOR_TRAITS).map((t) => ({ ...t, value: clean(t.value) })),
    trackRecord,
    basis: clean(basis, 200),
  };
}

/**
 * What one assessment observed about a body, distilled from its profile.
 *
 * A deterministic fallback, used when the merge call cannot run: the persona
 * still gains a row and the reader still sees a sighting, rather than the
 * assessment having met the body and recorded nothing.
 */
export function observationFromProfile(profile: Artefact | null): PersonaTrait[] {
  if (!profile) return [];
  const FROM_PROFILE: [TraitKey, string][] = [
    ['accountableTo', 'accountableTo'], ['judgedOn', 'successCriteria'], ['timeHorizon', 'timeHorizon'],
    ['resources', 'resources'], ['legalPowers', 'legalPowers'], ['informationControl', 'informationControlled'],
    ['constraints', 'constraints'], ['outsideOption', 'outsideOption'], ['gainFromFailure', 'gainFromFailure'],
    ['standingStrategies', 'strategies'], ['mandate', 'formalRole'],
  ];
  const traits: PersonaTrait[] = [];
  for (const [key, field] of FROM_PROFILE) {
    const raw = profile.data[field];
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as { value?: unknown; origin?: unknown; confidence?: unknown };
    const value = clean(f.value);
    if (!value || /^unknown\b/i.test(value)) continue;
    traits.push({ key, label: TRAIT_LABELS[key] ?? key, value, origin: String(f.origin ?? 'structural_inference'), confidence: typeof f.confidence === 'number' ? f.confidence : null });
  }
  return traits;
}

/** The plays an assessment found for one actor, in the shape a persona keeps them. */
export function playsFor(actorId: string, artefacts: Artefact[]) {
  return artefacts
    .filter((a) => a.kind === 'exploit' && a.data.actorId === actorId)
    .map((a) => ({ label: clean(a.label, 200), band: clean(a.data.band, 40) || 'limited', exposure: Number(a.data.exposure) || 0, legality: clean(a.data.legality, 40) }))
    .sort((a, b) => b.exposure - a.exposure)
    .slice(0, 12);
}

/**
 * Fold one assessment's traits into a standing dossier, key by key.
 *
 * The server's fallback when the merge call fails, and the shape the merge call
 * is asked to produce. A newer observation supersedes an older one for the same
 * key, EXCEPT where the older is an extracted fact and the newer is an
 * inference: an inference does not overwrite something a document actually said.
 */
const ORIGIN_RANK: Record<string, number> = {
  extracted_fact: 4, external_evidence: 3, model_result: 2, structural_inference: 1,
  behavioural_hypothesis: 1, prior_assessment: 0, normative_judgement: 0,
};

export function foldTraits(standing: PersonaTrait[], observed: PersonaTrait[]): PersonaTrait[] {
  const byKey = new Map(standing.map((t) => [t.key, t]));
  for (const trait of observed) {
    if (!trait.value) continue;
    const held = byKey.get(trait.key);
    if (held && (ORIGIN_RANK[held.origin] ?? 0) > (ORIGIN_RANK[trait.origin] ?? 0)) continue;
    byKey.set(trait.key, { ...trait, label: TRAIT_LABELS[trait.key] ?? trait.label ?? trait.key });
  }
  // Dossier order follows the vocabulary, not insertion, so two personas read
  // the same way down the page.
  const order = PERSONA_TRAITS.map(([key]) => key as string);
  return [...byKey.values()].sort((a, b) => {
    const ai = order.indexOf(a.key), bi = order.indexOf(b.key);
    return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || a.key.localeCompare(b.key);
  });
}
