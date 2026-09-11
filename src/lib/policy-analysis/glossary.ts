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
  /**
   * The arithmetic, written out, for anything the page COMPUTES.
   *
   * A figure with no stated derivation is a figure a policy professional cannot
   * argue with, and every number here is meant to be arguable. Present only
   * where there IS arithmetic — a model judgement has none, and saying so is
   * part of the answer.
   */
  formula?: string;
  /**
   * The plain-English name for the same thing.
   *
   * The vocabulary is game-theoretic and the reader is not a game theorist:
   * "concealment", "exposure", "dependants" and "standing" are each precise and
   * each opaque on first reading. Every table LEADS with this and keeps `label`
   * as the technical word beside it, so the term is learnable rather than either
   * mysterious or dumbed away.
   */
  plain?: string;
  /**
   * A ONE-WORD badge, for annotating a value rather than a column.
   *
   * `plain` is a phrase, and it reads correctly in the key or in a hover card.
   * Inside a grid cell "a guess about how a body would act" wrapped to three
   * lines under every value in the column and buried them. Only the origins
   * need one, because they are the only terms that label individual values.
   */
  short?: string;
};

const term = (
  key: string,
  label: string,
  what: string,
  why: string,
  read: string,
  provenance: Term['provenance'],
  extra: { formula?: string; plain?: string; short?: string } = {},
): Term => ({ key, label, what, why, read, provenance, ...extra });

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
    { plain: 'Reason to do it' },
  ),
  term(
    'ease',
    'Ease',
    'How little effort, capability, budget or coordination the play takes.',
    'A weakness only one very capable body could exploit is a different risk from one any of two hundred could.',
    'High means it is within reach of an ordinary actor on an ordinary day. Low does not mean safe — it means fewer bodies can reach it.',
    'model judgement',
    { plain: 'How easy it is' },
  ),
  term(
    'impact',
    'Impact',
    'How much of the policy’s stated objective the play defeats.',
    'Separates the irritating from the fatal. A play that shaves a target is not the same as one that inverts it.',
    'High means the policy substantially fails to do what it says it does, even while everybody follows it.',
    'model judgement',
    { plain: 'Damage if it happens' },
  ),
  term(
    'concealment',
    'Concealment',
    'How poorly the policy would notice — not how secretive the actor is.',
    'A weakness the policy can see is one it can answer. This factor is about the paper’s own instrumentation, not about anyone’s honesty.',
    'High means the policy has no reporting line, metric or trigger that would surface this. Low means it would show up, which is good news for the paper.',
    'model judgement',
    { plain: 'How hard it is to spot' },
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
  term('supports', 'Supports', 'Something outside the paper agrees with the claim.', 'A policy paper that cites itself is not evidenced.', 'Read the source quality beside it — a search excerpt agreeing with you is weak support.', 'model judgement', { plain: 'Backed up from outside' }),
  term('contradicts', 'Contradicts', 'Something outside the paper disagrees with the claim.', 'The single most useful thing external enquiry can return.', 'One contradiction is a question, not a refutation. Open it and read what was actually retrieved.', 'model judgement', { plain: 'Disagreed with from outside' }),
  term('mixed', 'Mixed', 'The external material cuts both ways.', 'Distinguishes a contested question from an unexamined one.', 'Usually means the claim is true under conditions the paper has not stated.', 'model judgement', { plain: 'Cuts both ways' }),
  term('insufficient', 'Insufficient', 'Nothing was found either way.', 'This is the honest answer for most claims in most policy papers, and hiding it would flatter the document.', 'Not a criticism of the claim. It means the assessment cannot help you defend it if challenged.', 'model judgement', { plain: 'Nothing found either way' }),
];

/** The verdicts one of the twelve structural checks can return. */
export const CHECK_TERMS: Term[] = [
  term('high_risk', 'High risk', 'The relationship the policy depends on is missing outright.', 'These are the failures a red team does not need a model to find.', 'The counterpart the policy relies on is not in the paper. Somebody is expected to do something they have not been given.', 'computed here', { plain: 'Missing outright' }),
  term('moderate_risk', 'Moderate risk', 'The relationship exists but is incomplete or one-sided.', 'Partial machinery fails in ways nobody has planned for.', 'Present but thin. Usually a resourcing or an authority gap rather than an absence.', 'computed here', { plain: 'There but thin' }),
  term('low_risk', 'Covered', 'The counterpart is present and stated.', 'Says which parts of the machinery are actually complete.', 'Covered as WRITTEN. It says nothing about whether it will work.', 'computed here', { plain: 'Present and stated' }),
  term('indeterminate', 'No evidence either way', 'The check had nothing to look at.', 'A check with no inputs is not a pass, and colouring it green would be the page’s worst lie.', 'The paper does not say enough for this check to run. Treat it as an open question, not as a clean bill.', 'computed here', { plain: 'Not enough in the paper to tell' }),
];

/** Where a statement came from. This is the page's epistemic backbone. */
export const ORIGIN_TERMS: Term[] = [
  term('extracted_fact', 'Extracted fact', 'Lifted from the paper, with the sentence it came from.', 'Near-certain by construction — it is a quotation.', 'Argue with the paper, not with the assessment.', 'from the paper', { plain: 'Quoted from the paper', short: 'quoted' }),
  term('external_evidence', 'External evidence', 'Retrieved from outside the paper during the enquiry stage.', 'The only claims here that are not about the document itself.', 'Check the retrieval date and whether it was full text or a search excerpt.', 'computed here', { plain: 'Found outside the paper', short: 'external' }),
  term('structural_inference', 'Structural inference', 'Derived from the relationships the paper states.', 'Deterministic — it follows from the graph rather than from a judgement.', 'If you disagree, you disagree with a relationship the paper asserted.', 'computed here', { plain: 'Follows from what the paper says', short: 'structural' }),
  term('behavioural_hypothesis', 'Behavioural hypothesis', 'A claim about how a body would act.', 'The whole red team rests on these, and they are the most arguable thing in the assessment.', 'This is where to push back. The stress test exists so you can fail one and see what falls.', 'model judgement', { plain: 'A guess about how a body would act', short: 'hypothesis' }),
  term('model_result', 'Model result', 'Output of a game-theoretic interaction model.', 'Semi-formal reasoning about incentives, not a numerical simulation.', 'Read its assumptions before its conclusion.', 'model judgement', { plain: 'Worked out from incentives', short: 'modelled' }),
  term('normative_judgement', 'Normative judgement', 'A view about what ought to happen.', 'Flagged separately so it is never mistaken for a finding.', 'This is an opinion and is labelled as one.', 'model judgement', { plain: 'An opinion about what should happen', short: 'opinion' }),
  term('prior_assessment', 'Prior assessment', 'Carried in from a body’s dossier in your persona library.', 'Context from previous work, never evidence on its own account.', 'Nothing rests on this alone — the provenance rules keep it out of the findings.', 'computed here', { plain: 'Carried in from earlier work', short: 'prior' }),
];

/** The three numbers an assumption carries, and the switch the reader can pull. */
export const ASSUMPTION_TERMS: Term[] = [
  term('importance', 'Importance', 'How much of the policy turns on this being true.', 'Separates load-bearing assumptions from stated ones.', 'High means a lot is stacked on it.', 'model judgement', { plain: 'How much turns on it' }),
  term('uncertainty', 'Uncertainty', 'How doubtful the assumption is.', 'A load-bearing assumption everybody agrees with is not a risk.', 'High means reasonable people would argue about it.', 'model judgement', { plain: 'How arguable it is' }),
  term('consequence', 'Consequence', 'What it would cost if it turned out false.', 'Some assumptions fail cheaply.', 'High means the failure is not recoverable inside the policy as written.', 'model judgement', { plain: 'Cost if it is wrong' }),
  term('dependants', 'Rests on it', 'How many models, scenarios, plays and conclusions cite this assumption.', 'Computed by walking the citations the assessment already made.', 'High means failing this one switch moves a lot of the page. Try it in the stress test.', 'computed here', { plain: 'Things resting on it', formula: 'A count of the models, scenarios, plays and conclusions whose own citations name this assumption.' }),
];

/** The measures the actor atlas can be redrawn on. */
export const ACTOR_MEASURE_TERMS: Term[] = [
  term('worst', 'Biggest risk', 'The highest-ranked play this body could run.', 'Answers "who should I worry about" in one number.', 'High means this body has at least one severe option. It says nothing about how many.', 'computed here', { plain: 'Worst thing it could do', formula: 'The single highest exposure among the plays that name this body.' }),
  term('plays', 'Exposures', 'How many exploitation plays name this body as the actor.', 'A body with one severe play is a different problem from one with nine moderate ones.', 'High means a broad surface rather than a single sharp edge.', 'computed here', { plain: 'How many things it could do', formula: 'A count of the plays whose actor is this body.' }),
  term('role', 'Role in the policy', 'How central this body is — how often the paper names it, weighted by how many relationships run through it.', 'The paper’s own sense of who matters, computed rather than asserted.', 'High means the policy runs through this body. If it also carries plays, that is the combination to read first.', 'computed here', { plain: 'How central it is', formula: 'Mentions in the paper × relationships in the graph, scaled so the most central body reads 100.' }),
  term('mentions', 'Times referenced', 'How many passages of the paper mention this body.', 'The rawest available measure of prominence.', 'High means the paper talks about it a lot. Prominence is not the same as power.', 'from the paper', { plain: 'Times the paper names it' }),
  term('degree', 'Relationships', 'How many relationships in the knowledge graph touch this body.', 'A body with many relationships is a single point of failure whether or not anyone attacks it.', 'High means a lot of the machinery is wired through it.', 'computed here', { plain: 'Links to other bodies', formula: 'A count of stated relationships with this body at either end, counting only those whose other end resolves to a body in the paper.' }),
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

/**
 * A family's key is PREFIXED for the glossary, and that is not cosmetic.
 *
 * The family `evidence` and the artefact kind `evidence` are different things —
 * "what the paper offers in support of its own claims" against "one of the
 * paper's claims tested against something retrieved from outside it" — and the
 * index is one `Map`, so the second insertion silently replaced the first.
 * Every hover on the structure "Evidence link" was showing the relation family's
 * definition instead. `familyTermKey` is the one way to ask for a family's
 * entry, so a caller cannot reintroduce the collision by hand.
 */
export const familyTermKey = (family: string) => `family_${family}`;

export const RELATION_FAMILY_TERMS: Term[] = RELATION_FAMILIES.map((f) =>
  term(
    familyTermKey(f.key),
    f.label,
    f.what,
    'Twenty-six relation types is a vocabulary rather than a reading; the families are the questions a policy graph is actually asked.',
    'Read the density: a family with many relationships is machinery the paper has thought about. A family with almost none is machinery it has assumed.',
    'from the paper',
    { plain: f.what },
  ),
);

/**
 * WHAT THE ASSESSMENT IS MADE OF.
 *
 * The measures above were explained and the STRUCTURES were not, which is the
 * harder gap: a reader who does not know what a "play" or an "assumption" is in
 * this document cannot use a column that scores one. Nothing here is a value
 * either — these are the sixteen things the pipeline emits, in the order the
 * argument runs, each with what it is, why it exists and how to read one.
 *
 * `read` carries the trap. Most of them have one: a claim is what the paper
 * ASSERTS rather than what is true, a check that found nothing is not a pass, a
 * play is a hypothesis about incentives rather than an accusation, and a
 * redesign option is an opinion.
 */
export const STRUCTURE_TERMS: Term[] = [
  term(
    'passage',
    'Passage',
    'A numbered stretch of the paper itself, kept verbatim.',
    'Every other thing in the assessment has to point back at one. It is what makes a finding checkable against the document rather than against the assessment.',
    'If something cites no passage, it is a judgement about the paper and not a reading of it.',
    'from the paper',
    { plain: 'A piece of the paper' },
  ),
  term(
    'mechanism',
    'Mechanism',
    'A piece of machinery the paper relies on to get its result — a duty, a power, a payment, a return, an inspection, a target.',
    'A policy is only ever as good as its machinery. The red team aims at mechanisms, not at intentions.',
    'Read whether the mechanism names who operates it. A mechanism with no operator is the commonest gap in a policy paper.',
    'from the paper',
    { plain: 'A piece of the machinery' },
  ),
  term(
    'claim',
    'Claim',
    'Something the paper states as fact.',
    'Separates what the document asserts from what anybody has established. The evidence stage tests these against material outside the paper.',
    'A claim is what the paper SAYS. Its presence here is not agreement with it.',
    'from the paper',
    { plain: 'Something the paper states' },
  ),
  term(
    'assumption',
    'Assumption',
    'Something that has to be true for the policy to work, which the paper does not itself establish.',
    'These are the joints of the argument, and the stress test exists so you can pull one out and watch what falls.',
    'An assumption is not a mistake. A policy with no assumptions would be a policy with nothing to decide.',
    'model judgement',
    { plain: 'Something taken as given' },
  ),
  term(
    'actor',
    'Body',
    'An organisation, a class of organisation, or a group of people the policy runs through.',
    'A policy does not act; bodies act. Most of a paper’s actors are CLASSES — "large registered providers", "tenants" — rather than named institutions, and the assessment keeps them as they are found.',
    'A class is not a body with a board. Read a play against a class as "some member of this group could", never as "they would".',
    'from the paper',
    { plain: 'Who the policy runs through' },
  ),
  term(
    'profile',
    'Profile',
    'A body’s dossier: its mandate, who it answers to, what it is judged on, how far ahead it can look, what it controls, what constrains it, what it would do instead, and who gains if the policy fails.',
    'A play is only credible if the body running it has a reason. The profile is where that reason is written down and argued with.',
    'The line to read first is the one an assurance review never asks: who is better off if this fails.',
    'model judgement',
    { plain: 'What moves a body' },
  ),
  term(
    'edge',
    'Relationship',
    'A link the paper states between two bodies, or between a body and a mechanism — who can direct whom, who pays, who delivers, who answers for it.',
    'The structural checks are computed over these and nothing else, which is why they are the only figures here that no model produced.',
    'The interesting reading is the absence: a relationship the paper needs and never states.',
    'from the paper',
    { plain: 'A stated link' },
  ),
  term(
    'evidence',
    'Evidence link',
    'One of the paper’s claims tested against something retrieved from outside it.',
    'A policy paper that cites only itself is not evidenced, and saying so is more useful than a score.',
    '"Nothing found either way" is the honest answer for most claims in most papers. It is not a criticism of the claim.',
    'computed here',
    { plain: 'A claim checked outside' },
  ),
  term(
    'test',
    'Structural check',
    'A deterministic test over the relationships the paper states — responsibility with authority, accountability with resources, a measure with somebody who owns its data.',
    'No model is involved, so these are the findings that do not move when a judgement is argued with.',
    'A check with nothing to look at is NOT a pass. Where the paper says too little for a check to run it is recorded as an open question.',
    'computed here',
    { plain: 'A test of the paper’s own wiring' },
  ),
  term(
    'model',
    'Interaction model',
    'Semi-formal reasoning about how two bodies’ incentives meet — a race, a hold-up, a free ride, a gamed measure.',
    'Some failures only appear when two rational bodies act at once, and neither body’s own profile shows them.',
    'Read its assumptions before its conclusion. It is reasoning about incentives, not a numerical simulation.',
    'model judgement',
    { plain: 'Two bodies, both acting' },
  ),
  term(
    'scenario',
    'Scenario',
    'A standing condition stepped through: what changes, who moves first, what follows, whether anyone notices, and what would correct it.',
    'It is the test of whether the policy survives contact with a world that is not the one it was drafted in.',
    'The shape is the finding. A scenario whose "would anyone notice" beat is empty is one the policy would not see coming.',
    'model judgement',
    { plain: 'What happens if things change' },
  ),
  term(
    'exploit',
    'Play',
    'A concrete thing one named body could do to serve itself at the policy’s expense, preferring the things that stay inside the rules as written.',
    'This is the red team. Enforcement answers a breach; only a design change answers a play that is compliant.',
    'A play is a hypothesis about incentives, not an accusation about anyone. It assumes no bad intent — only that bodies respond to what they are judged on.',
    'model judgement',
    { plain: 'A way to beat the policy' },
  ),
  term(
    'cross_policy',
    'Cross-policy exposure',
    'A weakness that exists only because this policy and another coexist — one body told two incompatible things, a burden bearable once and not three times, an assumption several policies all rest on.',
    'No single document can contain this failure, so no single review can find it.',
    'Read which policy the other half came from. An exposure is recorded against the assessment that found it.',
    'computed here',
    { plain: 'A clash with another policy' },
  ),
  term(
    'finding',
    'Finding',
    'A conclusion in the written assessment. Every one has to cite a check, a model, a scenario, a play or a cross-policy exposure.',
    'It is the rule that stops the report asserting things the working never produced.',
    'Follow the citation. A finding you cannot trace to a result is a finding this assessment would have thrown away.',
    'model judgement',
    { plain: 'A conclusion' },
  ),
  term(
    'recommendation',
    'Redesign option',
    'A change to the paper that would close something found, with what it costs and who carries it.',
    'Kept apart from the findings and labelled, so a view about what ought to happen is never mistaken for a reading of what is there.',
    'This is an opinion. The finding behind it is the part to argue with first.',
    'model judgement',
    { plain: 'A suggested change' },
  ),
  term(
    'persona',
    'Persona',
    'A body’s standing dossier across every assessment you have run — twelve traits chosen because they survive a change of policy, plus the plays it has been shown able to run.',
    'The same bodies turn up in paper after paper, and starting from nothing each time throws that away.',
    'A prior is CONTEXT, never evidence. Nothing in the findings rests on it, and a field shaped by one says so.',
    'computed here',
    { plain: 'A body you have met before' },
  ),
];

/** Every term the page can explain, indexed once. */
const ALL: Term[] = [
  ...STRUCTURE_TERMS,
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
    {
      plain: 'Overall risk',
      formula:
        'The geometric mean of the four factors — the fourth root of their product — so four scores of 50 read as 50, and any one factor at zero takes the play off the table. Concealment alone has a floor of 0.15, because an overt play (open lobbying, a public veto, judicial review) is honestly unhidden and still a threat. Bands: severe from 70, significant from 50, moderate from 30.',
    },
  ),
  term(
    'confidence',
    'Confidence',
    'How sure the assessment is that a statement is true.',
    'Kept strictly apart from exposure, which is how badly something would hurt.',
    'A model or extraction judgement, not a calibrated probability. Treat it as a sort order, not as a number.',
    'model judgement',
    { plain: 'How sure the assessment is' },
  ),
  term(
    'legality',
    'Legality',
    'Whether the play stays inside the rules as written.',
    'The red team deliberately prefers plays that are COMPLIANT.',
    '"Stays within the rules" is the worst case, not the best: there is no enforcement answer to it. Only a design change closes a compliant play.',
    'model judgement',
    { plain: 'Whether it breaks any rule' },
  ),
  term(
    'standing',
    'Standing',
    'What happens to a conclusion when an assumption it rests on is switched off.',
    'Walks the citations the assessment already made, so the same switches always give the same answer.',
    '"Unsupported" does not mean shown to be wrong. It means nothing that was offered for it still stands.',
    'computed here',
    { plain: 'What is left holding it up', formula: 'A conclusion loses its footing when every assumption it cites has been switched off.' },
  ),
  term(
    'disarmed',
    'Disarmed',
    'A play whose precondition the reader has switched off.',
    'The opposite direction to a weakened conclusion, from the same switch.',
    'The actor needed that to be true. This is the direction that helps the paper — which is why the two are never added together.',
    'computed here',
    { plain: 'Plays this takes off the table' },
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

/**
 * THE CHAIN, IN ORDER.
 *
 * The structures above are a list, and a list does not say how they JOIN. Every
 * figure on this page is downstream of the paper itself, and a reader who can
 * see the chain can also see what a number is allowed to mean: a play cannot
 * exist without a body, a body cannot exist without a passage naming it, and a
 * finding that cites none of it is one the assessment discards.
 */
export const READING_CHAIN: { step: string; then: string }[] = [
  { step: 'The paper', then: 'is cut into numbered passages, kept verbatim.' },
  { step: 'Passages', then: 'yield the objectives, the machinery, the claims and the bodies named.' },
  { step: 'Bodies', then: 'get a profile: what they answer to, what they are judged on, who gains if this fails.' },
  { step: 'The paper’s own words', then: 'give the relationships between them — who directs, who pays, who delivers, who answers.' },
  { step: 'Those relationships', then: 'are enough on their own for twelve structural checks, computed with no model.' },
  { step: 'Profiles and relationships', then: 'drive the interaction models and the scenarios.' },
  { step: 'All of it', then: 'produces the plays: what one body could do, preferring what stays inside the rules.' },
  { step: 'The findings', then: 'must each cite a check, a model, a scenario, a play or a cross-policy clash.' },
  { step: 'Redesign options', then: 'hang off a finding, and are labelled as opinions rather than results.' },
];

/**
 * The panel's own running order.
 *
 * Grouped for a reader who has arrived with a question — "what IS this column",
 * "where did this number come from", "what does severe mean" — rather than
 * alphabetically, which answers none of those.
 */
export const KEY_SECTIONS: { title: string; blurb: string; terms: Term[] }[] = [
  {
    title: 'What the assessment is made of',
    blurb: 'Sixteen things, in the order the argument runs. Everything else is one of these, or a measure over them.',
    terms: STRUCTURE_TERMS,
  },
  {
    title: 'How a play is ranked',
    blurb: 'Four judgements a policy professional can argue with, and one figure computed from them.',
    terms: [...FACTOR_TERMS, explain('exposure')!, explain('legality')!],
  },
  {
    title: 'What the bands mean',
    blurb: 'Thresholds on that one figure. A band is a magnitude, not a category.',
    terms: BAND_TERMS,
  },
  {
    title: 'How a body is measured',
    blurb: 'Five measures, each already in the assessment before it was drawn. The chart redraws on whichever you pick.',
    terms: ACTOR_MEASURE_TERMS,
  },
  {
    title: 'How an assumption is weighed',
    blurb: 'Three judgements and one count. The stress test offers only the assumptions something actually cites.',
    terms: [...ASSUMPTION_TERMS, explain('standing')!, explain('disarmed')!],
  },
  {
    title: 'What a check can return',
    blurb: 'The only figures here no model produced.',
    terms: CHECK_TERMS,
  },
  {
    title: 'What the evidence stage can find',
    blurb: 'A claim in the paper tested against something outside it.',
    terms: EVIDENCE_TERMS,
  },
  {
    title: 'The families a relationship falls into',
    blurb: 'Twenty-six relation types in the vocabulary; seven questions a reader actually asks of them.',
    terms: RELATION_FAMILY_TERMS,
  },
  {
    title: 'Where a statement comes from',
    blurb: 'Every statement in the assessment carries one of these, and it is the first thing to read.',
    terms: [...ORIGIN_TERMS, explain('confidence')!],
  },
];
