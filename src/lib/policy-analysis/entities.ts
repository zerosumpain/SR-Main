import { assessIdentity } from '$lib/jkai/intel/resolve/policy';
import { artefact, type Artefact } from './contracts';

/** Reuse the site's identity policy within this private analysis, without writing
 * submitted entities into the owner's shared intelligence graph. */
export function preserveAmbiguity(output: Artefact[], prior: Artefact[]): Artefact[] {
  const result = [...output]; const replaced = new Set<string>();
  for (const actor of output.filter((a) => a.kind === 'actor')) {
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
