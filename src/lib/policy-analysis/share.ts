import { STAGES, type Artefact } from './contracts';

/**
 * What a shared, read-only copy of an assessment may contain.
 *
 * A share link hands a policy professional the report without a login. It must
 * not hand them anything else, and "anything else" here is specific and worth
 * naming, because the owner is sharing ONE assessment out of a private
 * workspace:
 *
 * - **The policy paper itself.** `passage` artefacts hold the extracted document
 *   in full — up to 600,000 characters of somebody's unpublished draft. The
 *   report cites it in short spans (`sourceQuote`, with its page and section),
 *   which is how a report cites; the whole text is not the report.
 * - **The reader's OTHER assessments.** A `cross_policy` artefact names another
 *   analysis by id and title. Sharing this report would disclose the existence,
 *   the titles and the weaknesses of papers the recipient was never given.
 * - **The persona library**, for the same reason: a dossier is drawn from every
 *   assessment that met that body.
 * - **The run log** — prompts, model output, provider, spend, the uploaded file.
 *   That is the owner's audit trail, not part of the assessment.
 *
 * This module is pure so the rule can be tested rather than trusted. The route
 * calls it; nothing else assembles a shared payload.
 */

/** Kinds that never leave the owner's account. */
export const WITHHELD_KINDS = ['passage', 'cross_policy'] as const;

/**
 * Stages whose WARNINGS are withheld along with their output.
 *
 * Cross-policy exposure reports how many other assessments it compared against,
 * and the persona library names bodies from the reader's other papers. A warning
 * is prose written for the owner; when the chapter it belongs to is not in the
 * shared copy, neither is its commentary.
 */
const WITHHELD_STAGES = new Set([STAGES.indexOf('Cross-policy exposure'), STAGES.indexOf('Actor persona library')]);

/** Every `data` field that holds artefact identifiers, so a withheld id can be pruned from it. */
const ID_FIELDS = ['players', 'assumptions', 'resultIds', 'hypothesisIds', 'findingIds', 'candidates', 'mentions', 'dependencies', 'affectedOutcomes', 'targets', 'preconditions', 'inputs', 'actors', 'otherArtefactIds'];
const ID_SCALARS = ['actorId', 'entityId', 'questionId', 'claimId', 'mechanismId', 'assumptionId', 'firstActor', 'sourceId'];

export type SharedReport = {
  artefacts: Artefact[];
  /** What was left out, in figures, so the shared page can say so rather than look complete. */
  withheld: { kind: string; count: number }[];
  warnings: { stage: string; text: string }[];
};

export function shareableReport(input: { artefacts: Artefact[]; stages: { ordinal: number; name: string; warnings: string[] }[] }): SharedReport {
  const withheldKinds = new Set<string>(WITHHELD_KINDS);
  const kept = input.artefacts.filter((a) => !withheldKinds.has(a.kind));
  const alive = new Set(kept.map((a) => a.id));

  // A reference to a withheld artefact is a dead identifier on the shared page,
  // so it is dropped rather than rendered as a link to nothing. The quote, page
  // and section stay on the artefact that made the claim, which is the part a
  // reader actually needs.
  const artefacts = kept.map((a) => {
    const data: Record<string, unknown> = { ...a.data };
    for (const field of ID_FIELDS) {
      const values = data[field];
      if (Array.isArray(values)) data[field] = values.filter((v) => typeof v !== 'string' || alive.has(v));
    }
    for (const field of ID_SCALARS) {
      if (typeof data[field] === 'string' && !alive.has(data[field] as string)) data[field] = null;
    }
    return {
      ...a,
      data,
      refs: a.refs.filter((id) => alive.has(id)),
      sourceId: a.sourceId && alive.has(a.sourceId) ? a.sourceId : null,
      fromId: a.fromId && alive.has(a.fromId) ? a.fromId : a.fromId,
      toId: a.toId && alive.has(a.toId) ? a.toId : a.toId,
    };
  });

  const withheld = [...withheldKinds]
    .map((kind) => ({ kind, count: input.artefacts.filter((a) => a.kind === kind).length }))
    .filter((row) => row.count > 0);

  const warnings = input.stages
    .filter((s) => !WITHHELD_STAGES.has(s.ordinal))
    .flatMap((s) => s.warnings.map((text) => ({ stage: s.name, text })));

  return { artefacts, withheld, warnings };
}

/** Plain English for what a shared copy leaves out, for the page to print. */
export function withheldNote(withheld: { kind: string; count: number }[]): string | null {
  const parts: string[] = [];
  const cross = withheld.find((w) => w.kind === 'cross_policy');
  if (cross) parts.push(`${cross.count} cross-policy ${cross.count === 1 ? 'exposure' : 'exposures'}, which name other assessments in the author's account`);
  if (withheld.some((w) => w.kind === 'passage')) parts.push('the policy document itself, which is quoted here in short spans rather than reproduced');
  if (!parts.length) return null;
  return `This shared copy leaves out ${parts.join(', and ')}. Everything else is the assessment as written.`;
}
