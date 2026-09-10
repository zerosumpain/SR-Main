import { assessIdentity } from '$lib/jkai/intel/resolve/policy';
import { artefact, type Artefact } from './contracts';

/** Reuse the site's identity policy within this private analysis, without writing
 * submitted entities into the owner's shared intelligence graph. */
export function preserveAmbiguity(output: Artefact[], prior: Artefact[]): Artefact[] {
  const result = [...output]; const replaced = new Set<string>();
  for (const actor of output.filter((a) => a.kind === 'actor')) {
    // A CLASS is not a body, so there is no identity here to be unsure about.
    // Splitting one would assert the opposite of what it says: that twenty-five
    // mentions of "employers" are twenty-five candidate organisations. MEASURED
    // on the Post-16 white paper (2026-09-10) before this existed — the register
    // committed 336 single-mention candidates against 16 named bodies, which then
    // cost the graph stage 889 shed artefacts and left it with 9 nodes.
    if (actor.data.collective === true) continue;
    const mentions = (actor.data.mentions as string[]).map((id) => prior.find((a) => a.id === id)).filter((a): a is Artefact => !!a);
    const entity = (a: Artefact) => ({ id: a.id, name: a.label, typeId: String(a.data.entityType), typeName: String(a.data.entityType), degree: 0, noteCount: 1, aliases: a.data.aliases as string[] });
    const ambiguous = mentions.some((a, i) => mentions.slice(i + 1).some((b) => !assessIdentity(entity(a), entity(b)).canLink || (a.data.parent && b.data.parent && a.data.parent !== b.data.parent)));
    if (!ambiguous) continue;
    replaced.add(actor.id);
    const candidates = mentions.map((mention, index) => ({ ...mention, id: `${actor.id.slice(0, 75)}_candidate_${index}`, refs: [mention.id], origin: 'structural_inference' as const, confidence: null, data: { ...mention.data, mentions: [mention.id], ambiguity: 'Shared names or conflicting context do not establish identity. Retained as separate candidates.' } }));
    result.push(...candidates, artefact(actor.id, 'resolution_candidate', `Unresolved: ${actor.label}`.slice(0, 300), 'The existing identity policy could not establish that these mentions denote one entity.', { candidates: candidates.map((c) => c.id), reason: 'Insufficient independent identity evidence or conflicting context.', resolved: false }, { refs: candidates.map((c) => c.id) }));
  }
  return result.filter((a) => !(a.kind === 'actor' && replaced.has(a.id)) && !(a.kind === 'alias' && replaced.has(String(a.data.actorId))));
}

/**
 * Which actors in another assessment might be the SAME body as one here.
 *
 * Without this the cross-policy stage decides identity from label text alone,
 * which is the conflation failure this codebase has been bitten by before. The
 * site's own identity policy is applied across the boundary and its verdict is
 * handed to the model as a HINT, never as a merge — two assessments of two
 * policies are entitled to describe the same body differently, and a shared name
 * has never been evidence of a shared identity.
 */
export function crossIdentityHints(
  local: Artefact[],
  neighbours: { id: string; artefacts: { id: string; kind: string; label: string; entityType?: string; aliases?: string[] }[] }[],
) {
  const entity = (id: string, name: string, type: string, aliases: string[]) => ({ id, name, typeId: type, typeName: type, degree: 0, noteCount: 1, aliases });
  const here = local.filter((a) => a.kind === 'actor' && a.id.startsWith('s2_'));
  const hints: { actorId: string; actorLabel: string; otherAnalysisId: string; otherArtefactId: string; otherLabel: string; verdict: 'same_body' | 'possibly_same' }[] = [];
  for (const actor of here) {
    const mine = entity(actor.id, actor.label, String(actor.data.entityType ?? ''), (actor.data.aliases as string[]) ?? []);
    for (const neighbour of neighbours) {
      for (const other of neighbour.artefacts) {
        if (other.kind !== 'actor') continue;
        const theirs = entity(other.id, other.label, other.entityType ?? '', other.aliases ?? []);
        const canLink = assessIdentity(mine, theirs).canLink;
        const sameName = mine.name.trim().toLowerCase() === theirs.name.trim().toLowerCase();
        if (!canLink && !sameName) continue;
        hints.push({ actorId: actor.id, actorLabel: actor.label, otherAnalysisId: neighbour.id, otherArtefactId: other.id, otherLabel: other.label, verdict: canLink ? 'same_body' : 'possibly_same' });
        if (hints.length >= 120) return hints;
      }
    }
  }
  return hints;
}
