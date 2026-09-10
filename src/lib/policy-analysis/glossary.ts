/**
 * What the words on this page MEAN.
 *
 * The assessment is a game-theoretic read of a policy paper, and its reader is a
 * policy professional who did not necessarily write the paper and has no reason
 * to know what "concealment" is doing in a ranking or why a check that found
 * nothing is not a pass. Every column type, factor, band and verdict on the page
 * therefore carries an explainer, and they all live here.
 *
 * The split is the one `$lib/health/metric-registry.ts` keeps and for the same
 * reason: this module holds MEANINGS and no values. A term is what it is
 * regardless of which assessment is on screen, so nothing here takes an
 * artefact, and the whole file is testable by reading it.
 *
 * `read` is deliberately the third field. `what` says what the column is, `why`
 * says why the assessment bothers to compute it, and `read` tells you what a
 * HIGH number actually means — which is the one a reader gets wrong, because
 * three of the four exposure factors are bad news when they are high and the
 * fourth is bad news when the policy is good at hiding things from itself.
 */

export type Term = {
  key: string;
  label: string;
  /** What this column or word is. */
  what: string;
  /** Why the assessment computes it at all. */
  why: string;
  /** How to read a high value, or the verdict word. */
  read: string;
  /** Where the value comes from — a model judgement, a computation, the paper. */
  provenance: 'model judgement' | 'computed here' | 'from the paper' | 'from the reader';
};

const term = (
  key: string,
  label: string,
  what: string,
  why: string,
  read: string,
  provenance: Term['provenance'],
): Term => ({ key, label, what, why, read, provenance });

/**
 * The four factors behind every exploitation play's rank.
 *
 * These are the ones the reader most needs explained, because the ranking is a
 * geometric mean of them and a play can be top of the list for four quite
 * different reasons. `exposure.ts` holds the arithmetic; this holds the English.
 */
export const FACTOR_TERMS: Term[] = [
  term(
    'incentive',
    'Incentive',
    'How much the actor gains by doing it — money, autonomy, reputation, a quieter life.',
    'A play nobody wants to run is not a threat, however easy it is. This is the factor that separates a theoretical weakness from a live one.',
    'High means somebody is actively better off doing this. That is the hardest kind of weakness to close, because goodwill will not close it.',
    'model judgement',
  ),
  term(
    'ease',
    'Ease',
    'How little effort, capability, budget or coordination the play takes.',
    'A weakness only one very capable body could exploit is a different risk from one any of two hundred could.',
    'High means it is within reach of an ordinary actor on an ordinary day. Low does not mean safe — it means fewer bodies can reach it.',
    'model judgement',
  ),
  term(
    'impact',
    'Impact',
    'How much of the policy’s stated objective the play defeats.',
    'Separates the irritating from the fatal. A play that shaves a target is not the same as one that inverts it.',
    'High means the policy substantially fails to do what it says it does, even while everybody follows it.',
    'model judgement',
  ),
  term(
    'concealment',
    'Concealment',
    'How poorly the policy would notice — not how secretive the actor is.',
    'A weakness the policy can see is one it can answer. This factor is about the paper’s own instrumentation, not about anyone’s honesty.',
    'High means the policy has no reporting line, metric or trigger that would surface this. Low means it would show up, which is good news for the paper.',
    'model judgement',
  ),
];

/** Bands are a magnitude, so their explainers describe a threshold, not a category. */
export const BAND_TERMS: Term[] = [
  term(
    'severe',
    'Severe',
    'The four factors blend above 0.70.',
    'Strong incentive, low effort, real damage, and the policy would not see it.',
    'These are the plays to answer before the paper goes out. There is usually no monitoring answer to a severe play — it needs a design change.',
    'computed here',
  ),
  term(
    'significant',
    'Significant',
    'The four factors blend between 0.50 and 0.70.',
    'A play a rational actor would at least consider.',
    'Needs either a counter-measure or an explicit, recorded decision to accept it. Silence here reads as an oversight later.',
    'computed here',
  ),
  term(
    'moderate',
    'Moderate',
    'The four factors blend between 0.30 and 0.50.',
    'Plausible but constrained — usually by capability or by visibility.',
    'Worth a monitoring commitment rather than a redesign. Watch whether the constraint that holds it down is itself an assumption.',
    'computed here',
  ),
  term(
    'limited',
    'Limited',
    'The four factors blend below 0.30.',
    'Weak on at least one factor.',
    'Recorded so the assessment can be shown to have considered it. Not a to-do.',
    'computed here',
  ),
];

/** The four outcomes an evidence link can have. Categorical, hence the legend rule. */
export const EVIDENCE_TERMS: Term[] = [
  term('supports', 'Supports', 'Something outside the paper agrees with the claim.', 'A policy paper that cites itself is not evidenced.', 'Read the source quality beside it — a search excerpt agreeing with you is weak support.', 'model judgement'),
  term('contradicts', 'Contradicts', 'Something outside the paper disagrees with the claim.', 'The single most useful thing external enquiry can return.', 'One contradiction is a question, not a refutation. Open it and read what was actually retrieved.', 'model judgement'),
  term('mixed', 'Mixed', 'The external material cuts both ways.', 'Distinguishes a contested question from an unexamined one.', 'Usually means the claim is true under conditions the paper has not stated.', 'model judgement'),
  term('insufficient', 'Insufficient', 'Nothing was found either way.', 'This is the honest answer for most claims in most policy papers, and hiding it would flatter the document.', 'Not a criticism of the claim. It means the assessment cannot help you defend it if challenged.', 'model judgement'),
];

/** The verdicts one of the twelve structural checks can return. */
export const CHECK_TERMS: Term[] = [
  term('high_risk', 'High risk', 'The relationship the policy depends on is missing outright.', 'These are the failures a red team does not need a model to find.', 'The counterpart the policy relies on is not in the paper. Somebody is expected to do something they have not been given.', 'computed here'),
  term('moderate_risk', 'Moderate risk', 'The relationship exists but is incomplete or one-sided.', 'Partial machinery fails in ways nobody has planned for.', 'Present but thin. Usually a resourcing or an authority gap rather than an absence.', 'computed here'),
  term('low_risk', 'Covered', 'The counterpart is present and stated.', 'Says which parts of the machinery are actually complete.', 'Covered as WRITTEN. It says nothing about whether it will work.', 'computed here'),
  term('indeterminate', 'No evidence either way', 'The check had nothing to look at.', 'A check with no inputs is not a pass, and colouring it green would be the page’s worst lie.', 'The paper does not say enough for this check to run. Treat it as an open question, not as a clean bill.', 'computed here'),
];

/** Where a statement came from. This is the page's epistemic backbone. */
export const ORIGIN_TERMS: Term[] = [
  term('extracted_fact', 'Extracted fact', 'Lifted from the paper, with the sentence it came from.', 'Near-certain by construction — it is a quotation.', 'Argue with the paper, not with the assessment.', 'from the paper'),
  term('external_evidence', 'External evidence', 'Retrieved from outside the paper during the enquiry stage.', 'The only claims here that are not about the document itself.', 'Check the retrieval date and whether it was full text or a search excerpt.', 'computed here'),
  term('structural_inference', 'Structural inference', 'Derived from the relationships the paper states.', 'Deterministic — it follows from the graph rather than from a judgement.', 'If you disagree, you disagree with a relationship the paper asserted.', 'computed here'),
  term('behavioural_hypothesis', 'Behavioural hypothesis', 'A claim about how a body would act.', 'The whole red team rests on these, and they are the most arguable thing on the page.', 'This is where to push back. The stress test exists so you can fail one and see what falls.', 'model judgement'),
  term('model_result', 'Model result', 'Output of a game-theoretic interaction model.', 'Semi-formal reasoning about incentives, not a numerical simulation.', 'Read its assumptions before its conclusion.', 'model judgement'),
  term('normative_judgement', 'Normative judgement', 'A view about what ought to happen.', 'Flagged separately so it is never mistaken for a finding.', 'This is an opinion and is labelled as one.', 'model judgement'),
  term('prior_assessment', 'Prior assessment', 'Carried in from a body’s dossier in your persona library.', 'Context from previous work, never evidence on its own account.', 'Nothing rests on this alone — the provenance rules keep it out of the findings.', 'computed here'),
];

/** The three numbers an assumption carries, and the switch the reader can pull. */
export const ASSUMPTION_TERMS: Term[] = [
  term('importance', 'Importance', 'How much of the policy turns on this being true.', 'Separates load-bearing assumptions from stated ones.', 'High means a lot is stacked on it.', 'model judgement'),
  term('uncertainty', 'Uncertainty', 'How doubtful the assumption is.', 'A load-bearing assumption everybody agrees with is not a risk.', 'High means reasonable people would argue about it.', 'model judgement'),
  term('consequence', 'Consequence', 'What it would cost if it turned out false.', 'Some assumptions fail cheaply.', 'High means the failure is not recoverable inside the policy as written.', 'model judgement'),
  term('dependants', 'Rests on it', 'How many models, scenarios, plays and conclusions cite this assumption.', 'Computed by walking the citations the assessment already made.', 'High means failing this one switch moves a lot of the page. Try it in the stress test.', 'computed here'),
];

/** The measures the actor atlas can be redrawn on. */
export const ACTOR_MEASURE_TERMS: Term[] = [
  term('worst', 'Biggest risk', 'The highest-ranked play this body could run.', 'Answers "who should I worry about" in one number.', 'High means this body has at least one severe option. It says nothing about how many.', 'computed here'),
  term('plays', 'Exposures', 'How many exploitation plays name this body as the actor.', 'A body with one severe play is a different problem from one with nine moderate ones.', 'High means a broad surface rather than a single sharp edge.', 'computed here'),
  term('role', 'Role in the policy', 'How central this body is — how often the paper names it, weighted by how many relationships run through it.', 'The paper’s own sense of who matters, computed rather than asserted.', 'High means the policy runs through this body. If it also carries plays, that is the combination to read first.', 'computed here'),
  term('mentions', 'Times referenced', 'How many passages of the paper mention this body.', 'The rawest available measure of prominence.', 'High means the paper talks about it a lot. Prominence is not the same as power.', 'from the paper'),
  term('degree', 'Relationships', 'How many relationships in the knowledge graph touch this body.', 'A body with many relationships is a single point of failure whether or not anyone attacks it.', 'High means a lot of the machinery is wired through it.', 'computed here'),
];

/**
 * Relation families.
 *
 * Twenty-six relation types is a vocabulary, not a reading. These seven families
 * are what a reader actually asks of a policy graph: who can tell whom what to
 * do, who pays, who delivers, who answers for it, who leans on whom, who depends
 * on whom, and what backs a claim.
 */
export const RELATION_FAMILIES = [
  { key: 'authority', label: 'Authority', relations: ['has_authority_over', 'can_veto', 'appoints', 'sanctions', 'regulates'], what: 'Who can tell whom what to do, and who can stop them.' },
  { key: 'money', label: 'Money and burden', relations: ['funds', 'commissions', 'bears_cost_of', 'receives_benefit_from'], what: 'Who pays, who is paid, and who carries the cost of the policy working.' },
  { key: 'delivery', label: 'Delivery and data', relations: ['delivers', 'supplies_data_to', 'owns_data', 'is_measured_by'], what: 'Who actually does the work, and what the policy measures them on.' },
  { key: 'accountability', label: 'Accountability', relations: ['reports_to', 'is_accountable_for'], what: 'Who answers for an outcome, and to whom.' },
  { key: 'influence', label: 'Influence', relations: ['lobbies', 'allies_with', 'competes_with', 'reciprocates'], what: 'Pressure that runs outside the formal machinery.' },
  { key: 'dependence', label: 'Dependence', relations: ['depends_on', 'is_exposed_to', 'can_adapt', 'assumes'], what: 'What has to hold for a body to do its part.' },
  { key: 'evidence', label: 'Evidence', relations: ['supports', 'contradicts', 'provides_evidence_for'], what: 'What the paper offers in support of, or against, its own claims.' },
] as const;

export type RelationFamilyKey = (typeof RELATION_FAMILIES)[number]['key'];

export const RELATION_FAMILY_TERMS: Term[] = RELATION_FAMILIES.map((f) =>
  term(
    f.key,
    f.label,
    f.what,
    'Twenty-six relation types is a vocabulary rather than a reading; the families are the questions a policy graph is actually asked.',
    'Read the density: a family with many relationships is machinery the paper has thought about. A family with almost none is machinery it has assumed.',
    'from the paper',
  ),
);

/** Every term the page can explain, indexed once. */
const ALL: Term[] = [
  ...FACTOR_TERMS,
  ...BAND_TERMS,
  ...EVIDENCE_TERMS,
  ...CHECK_TERMS,
  ...ORIGIN_TERMS,
  ...ASSUMPTION_TERMS,
  ...ACTOR_MEASURE_TERMS,
  ...RELATION_FAMILY_TERMS,
  term(
    'exposure',
    'Exposure',
    'The even blend of incentive, ease, impact and concealment, on a 0–100 scale.',
    'Computed here rather than asked of a model, so two runs over the same four judgements always rank the same way.',
    'It is a SEVERITY, not a certainty. A play at 82 is not one the assessment is 82% sure exists — it is one that would hurt.',
    'computed here',
  ),
  term(
    'confidence',
    'Confidence',
    'How sure the assessment is that a statement is true.',
    'Kept strictly apart from exposure, which is how badly something would hurt.',
    'A model or extraction judgement, not a calibrated probability. Treat it as a sort order, not as a number.',
    'model judgement',
  ),
  term(
    'legality',
    'Legality',
    'Whether the play stays inside the rules as written.',
    'The red team deliberately prefers plays that are COMPLIANT.',
    '"Stays within the rules" is the worst case, not the best: there is no enforcement answer to it. Only a design change closes a compliant play.',
    'model judgement',
  ),
  term(
    'standing',
    'Standing',
    'What happens to a conclusion when an assumption it rests on is switched off.',
    'Walks the citations the assessment already made, so the same switches always give the same answer.',
    '"Unsupported" does not mean shown to be wrong. It means nothing that was offered for it still stands.',
    'computed here',
  ),
  term(
    'disarmed',
    'Disarmed',
    'A play whose precondition the reader has switched off.',
    'The opposite direction to a weakened conclusion, from the same switch.',
    'The actor needed that to be true. This is the direction that helps the paper — which is why the two are never added together.',
    'computed here',
  ),
];

const INDEX = new Map(ALL.map((t) => [t.key, t]));

export function explain(key: string): Term | null {
  return INDEX.get(key) ?? null;
}

/** Every key the page can hand `explain()`. Exported so a test can assert coverage. */
export function explainable(): string[] {
  return [...INDEX.keys()];
}

/** Which family a relation belongs to, or null for one the vocabulary has since gained. */
export function familyOf(relation: string | null): RelationFamilyKey | null {
  if (!relation) return null;
  for (const family of RELATION_FAMILIES) {
    if ((family.relations as readonly string[]).includes(relation)) return family.key;
  }
  return null;
}
