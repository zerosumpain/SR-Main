// interview.ts — the interview-driven strategy generator's shared model (client-safe).
// A question bank in three cumulative tiers (quick / standard / in-depth), three
// document-length skeletons (concise / working / full → 9 depth×length combinations),
// and the answer digest that grounds every generated section in what the lead said.

export type InterviewKind = 'single' | 'multi' | 'scale' | 'text';
export type DepthId = 'quick' | 'standard' | 'indepth';
export type LengthId = 'concise' | 'working' | 'full';

export interface InterviewOption {
  id: string;
  label: string;
  detail?: string;
}

export interface InterviewQuestion {
  id: string;
  /** 1 = asked in every set; 2 = standard + in-depth; 3 = in-depth only. */
  tier: 1 | 2 | 3;
  /** Short label for the progress rail. */
  topic: string;
  text: string;
  hint?: string;
  kind: InterviewKind;
  options?: InterviewOption[];
  /** For multi: how many the UI suggests picking. */
  pick?: number;
  scale?: { left: string; right: string };
  /** Section template ids this answer informs (used to route answers into prompts). */
  sectionIds: string[];
}

export interface InterviewAnswer {
  id: string;
  optionIds?: string[];
  value?: number; // 0–100 for scale
  text?: string; // free-text elaboration (available on every question)
}

export const DEPTHS: { id: DepthId; label: string; blurb: string }[] = [
  { id: 'quick', label: 'Quick', blurb: 'The essentials — enough to set a direction.' },
  { id: 'standard', label: 'Standard', blurb: 'The essentials plus the big design choices.' },
  { id: 'indepth', label: 'In-depth', blurb: 'Every major decision a full strategy has to make.' },
];

export const LENGTHS: { id: LengthId; label: string; pages: string; blurb: string }[] = [
  { id: 'concise', label: 'Concise', pages: 'under 6 pages', blurb: 'A board-ready statement of direction.' },
  { id: 'working', label: 'Working draft', pages: '6–15 pages', blurb: 'A full working strategy across the core sections.' },
  { id: 'full', label: 'Full strategy', pages: '15+ pages', blurb: 'Every section, publication-shaped.' },
];

/** Rough words-per-page for the page estimates (gov strategy layout). */
export const PAGE_WORDS = 450;

export const INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  {
    id: 'ambition',
    tier: 1,
    topic: 'Ambition',
    text: 'What kind of strategy is this?',
    hint: 'Sets the register of the whole document — from the vision to the roadmap.',
    kind: 'single',
    options: [
      { id: 'consolidate', label: 'Consolidate', detail: 'Fix the foundations — quality, ownership, legal footing — before promising new things.' },
      { id: 'balance', label: 'Build while fixing', detail: 'Foundations first, but ship visible improvements each year.' },
      { id: 'transform', label: 'Transform', detail: 'A bold reshape: the data spine, real-time flows and AI-ready estate, on a hard timetable.' },
    ],
    sectionIds: ['vision', 'principles', 'delivery-roadmap'],
  },
  {
    id: 'audience',
    tier: 1,
    topic: 'Audience',
    text: 'Who is the strategy mainly written for?',
    kind: 'single',
    options: [
      { id: 'ministers', label: 'Ministers & the centre', detail: 'A political document: commitments, delivery, accountability.' },
      { id: 'sector', label: 'Schools, trusts & councils', detail: 'A partnership document: burden, give-back, trust.' },
      { id: 'internal', label: 'The department itself', detail: 'An operating-model document: teams, platforms, governance.' },
      { id: 'all', label: 'All three, deliberately', detail: 'One document that speaks to each audience in turn.' },
    ],
    sectionIds: ['vision', 'users-needs'],
  },
  {
    id: 'big-bets',
    tier: 1,
    topic: 'Big bets',
    text: 'Where should the strategy place its biggest bets?',
    hint: 'Pick up to three. Everything else becomes supporting work.',
    kind: 'multi',
    pick: 3,
    options: [
      { id: 'identifier', label: 'The identifier & single view', detail: 'The consistent child identifier and the data spine.' },
      { id: 'quality', label: 'Quality at source', detail: 'Fix the critical datasets where they are created.' },
      { id: 'sharing', label: 'Sharing & interoperability', detail: 'Standards, APIs and lawful flows between partners.' },
      { id: 'ai', label: 'AI & analytics', detail: 'Decision support, early warning, evaluation by default.' },
      { id: 'burden', label: 'Burden reduction', detail: 'Collect once, use many times; retire duplicate collections.' },
      { id: 'open', label: 'Open data & research', detail: 'The estate as national research infrastructure.' },
      { id: 'workforce', label: 'Workforce & literacy', detail: 'The data profession and data-literate leaders.' },
      { id: 'platforms', label: 'Platforms & architecture', detail: 'The analytical platform and the collections estate.' },
    ],
    sectionIds: ['vision', 'architecture-platforms', 'delivery-roadmap', 'funding'],
  },
  {
    id: 'centralise',
    tier: 1,
    topic: 'Operating model',
    text: 'Centralised platforms, or federated domain ownership?',
    hint: 'The oldest argument in data strategy. Your lean shapes architecture AND governance.',
    kind: 'scale',
    scale: { left: 'Centralised — one platform, one team, one truth', right: 'Federated — domains own their data as products' },
    sectionIds: ['architecture-platforms', 'governance-ownership', 'principles'],
  },
  {
    id: 'sharing-posture',
    tier: 1,
    topic: 'Sharing posture',
    text: 'Where do you sit between sharing and protecting?',
    kind: 'scale',
    scale: { left: 'Share by default, within the law', right: 'Minimise & protect — share only with a named case' },
    sectionIds: ['legal-basis', 'ethics-trust', 'identifiers', 'principles'],
  },
  {
    id: 'ai-posture',
    tier: 1,
    topic: 'AI stance',
    text: 'What is the AI posture?',
    kind: 'single',
    options: [
      { id: 'front-foot', label: 'Front foot', detail: 'Scale what works now; DfE is a named AI delivery partner.' },
      { id: 'pilots', label: 'Measured pilots', detail: 'Real pilots with published evaluations before scale.' },
      { id: 'foundations', label: 'Foundations first', detail: 'Quality, linkage and licensing before models.' },
      { id: 'restraint', label: 'Deliberate restraint', detail: 'Children’s data demands a higher bar; assist, never decide.' },
    ],
    sectionIds: ['analytics-ai', 'ethics-trust'],
  },
  {
    id: 'burden-deal',
    tier: 1,
    topic: 'The sector deal',
    text: 'What deal does the strategy offer schools and councils?',
    hint: 'DfE can compel collection but not goodwill — what makes joining in worth it?',
    kind: 'single',
    options: [
      { id: 'burden-targets', label: 'Hard burden-reduction targets', detail: 'Published hours-saved targets; collections retired by name.' },
      { id: 'give-back', label: 'Give-back products', detail: 'Benchmarking, dashboards and APIs schools actually want.' },
      { id: 'mandate', label: 'Mandate where it matters', detail: 'Statutory clarity over persuasion; fewer, firmer asks.' },
      { id: 'mixed-deal', label: 'A mixed deal', detail: 'Mandate the spine, give back products, cut burden visibly.' },
    ],
    sectionIds: ['users-needs', 'standards-interoperability', 'workforce-culture'],
  },
  {
    id: 'horizon',
    tier: 1,
    topic: 'Horizon',
    text: 'What delivery horizon should the roadmap commit to?',
    kind: 'single',
    options: [
      { id: 'h2', label: 'Two years', detail: 'Inside the spending-review window; everything dated.' },
      { id: 'h3', label: 'Three years', detail: 'The classic strategy arc: foundations, build, prove.' },
      { id: 'h5', label: 'Five years', detail: 'Generational: the spine, the estate, the profession.' },
    ],
    sectionIds: ['delivery-roadmap', 'measurement', 'funding'],
  },
  // ---- tier 2: the design choices ----
  {
    id: 'identifier-approach',
    tier: 2,
    topic: 'Identifier',
    text: 'The consistent child identifier — how should DfE play it?',
    hint: 'CWSA 2026 creates the duty; the NHS-number pilot is running. The strategy has to pick a line.',
    kind: 'single',
    options: [
      { id: 'adopt', label: 'Adopt & map', detail: 'Back the NHS number; map UPN/ULN onto it as the pilot proves out.' },
      { id: 'wrap', label: 'Wrap with a spine ID', detail: 'A DfE matching layer that joins NHS number, UPN and ULN without betting on one.' },
      { id: 'wait', label: 'Follow the evidence', detail: 'Commit to the duty, not the mechanism, until the pilot reports.' },
    ],
    sectionIds: ['identifiers', 'commitments-obligations'],
  },
  {
    id: 'quality-first',
    tier: 2,
    topic: 'Quality vs pace',
    text: 'Fix quality first, or build products and fix quality as you go?',
    kind: 'scale',
    scale: { left: 'Quality at source before anything new', right: 'Ship products now; let use drive quality' },
    sectionIds: ['data-quality', 'architecture-platforms'],
  },
  {
    id: 'governance-model',
    tier: 2,
    topic: 'Governance',
    text: 'Who holds the pen on data decisions?',
    kind: 'single',
    options: [
      { id: 'cdo', label: 'A CDO with hard rights', detail: 'Budget, standards veto and quality gates held centrally.' },
      { id: 'stewards', label: 'Federated stewards', detail: 'Named owners in each domain; a small centre that arbitrates.' },
      { id: 'board', label: 'Board-led', detail: 'A data board of directors-general; the CDO convenes.' },
    ],
    sectionIds: ['governance-ownership'],
  },
  {
    id: 'openness',
    tier: 2,
    topic: 'Openness',
    text: 'What is the default for research and public access?',
    kind: 'single',
    options: [
      { id: 'open-default', label: 'Open by default', detail: 'Publish unless there is a reason not to; EES and the API grow.' },
      { id: 'safe-access', label: 'Safe access by default', detail: 'De-identified researcher access via SRS/IDS and ADR UK routes.' },
      { id: 'case-by-case', label: 'Case by case', detail: 'Each release argued on its merits.' },
    ],
    sectionIds: ['open-data-research'],
  },
  {
    id: 'trust-redlines',
    tier: 2,
    topic: 'Red lines',
    text: 'Which red lines should the strategy state in writing?',
    hint: 'Pick the ones the department should be held to.',
    kind: 'multi',
    pick: 3,
    options: [
      { id: 'no-commercial', label: 'No commercial reuse of pupil-level data' },
      { id: 'no-enforcement', label: 'No enforcement uses beyond statutory duty', detail: 'The Home Office lesson: purpose creep costs trust.' },
      { id: 'atrs-all', label: 'ATRS entry for every algorithmic tool' },
      { id: 'child-view', label: 'Children & parents can see what is held' },
      { id: 'ethics-review', label: 'Independent ethics review for new joins' },
      { id: 'human-loop', label: 'No fully automated decisions about a child' },
    ],
    sectionIds: ['ethics-trust', 'principles'],
  },
  {
    id: 'funding-realism',
    tier: 2,
    topic: 'Funding',
    text: 'How is the strategy funded?',
    kind: 'single',
    options: [
      { id: 'funded', label: 'A funded programme', detail: 'A named envelope; the roadmap spends it.' },
      { id: 'sr-dependent', label: 'Spending-review dependent', detail: 'Phase 1 funded; later phases argued at the SR.' },
      { id: 'self-funded', label: 'Efficiency-funded', detail: 'Stop and consolidate collections/platforms to fund the new.' },
    ],
    sectionIds: ['funding', 'delivery-roadmap'],
  },
  // ---- tier 3: the full set ----
  {
    id: 'standards-mandate',
    tier: 3,
    topic: 'Standards',
    text: 'Mandate data standards on suppliers, or pull them along?',
    hint: 'The MIS procurement framework (from Sept 2027) is the lever either way.',
    kind: 'scale',
    scale: { left: 'Mandate — standards as a condition of the framework', right: 'Persuade — incentives, kitemarks and procurement weight' },
    sectionIds: ['standards-interoperability'],
  },
  {
    id: 'collections-estate',
    tier: 3,
    topic: 'Collections',
    text: 'What happens to the collections estate (census & returns)?',
    kind: 'single',
    options: [
      { id: 'consolidate-fast', label: 'Consolidate aggressively', detail: 'Name the collections that merge or retire, with dates.' },
      { id: 'api-first-new', label: 'API-first for the new', detail: 'New flows are API/event-driven; legacy migrates slowly.' },
      { id: 'census-until-proven', label: 'Census until the spine is proven', detail: 'No collection is switched off before its replacement has run a full year.' },
    ],
    sectionIds: ['architecture-platforms', 'data-quality'],
  },
  {
    id: 'workforce-shape',
    tier: 3,
    topic: 'Workforce',
    text: 'How does the data profession grow?',
    kind: 'single',
    options: [
      { id: 'central-profession', label: 'Grow the central profession', detail: 'Recruit and retain a bigger core team.' },
      { id: 'embedded', label: 'Embed analysts in policy teams', detail: 'Mixed teams; the centre sets standards.' },
      { id: 'buy-and-train', label: 'Buy while training', detail: 'Contract capability now, convert to permanent as skills grow.' },
    ],
    sectionIds: ['workforce-culture'],
  },
  {
    id: 'sector-giveback',
    tier: 3,
    topic: 'Give-back',
    text: 'What should DfE actually give the sector back?',
    kind: 'multi',
    pick: 3,
    options: [
      { id: 'benchmarking', label: 'Benchmarking dashboards', detail: '"Similar schools" intelligence, not raw tables.' },
      { id: 'giveback-api', label: 'A give-back API', detail: 'Schools and trusts can pull their own data out.' },
      { id: 'mis-standards', label: 'MIS standards & sync checks', detail: 'Catch the 8-hour/52-hour errors before they propagate.' },
      { id: 'training', label: 'Training for school data staff' },
      { id: 'la-units', label: 'Funded LA data capacity' },
    ],
    sectionIds: ['users-needs', 'workforce-culture'],
  },
  {
    id: 'security-posture',
    tier: 3,
    topic: 'Security',
    text: 'What security bar do the critical services meet?',
    kind: 'single',
    options: [
      { id: 'cni-grade', label: 'CNI-grade for the spine', detail: 'Treat identifier + attendance + safeguarding flows as critical national infrastructure in all but name.' },
      { id: 'tiered', label: 'Tiered by service', detail: 'Proportionate assurance by sensitivity and scale.' },
      { id: 'baseline-plus', label: 'Baseline plus playbook', detail: 'Current posture, plus a rehearsed sector-facing incident playbook.' },
    ],
    sectionIds: ['security'],
  },
  {
    id: 'measurement-discipline',
    tier: 3,
    topic: 'Measurement',
    text: 'How publicly does the strategy measure itself?',
    kind: 'single',
    options: [
      { id: 'public-scorecard', label: 'A public annual scorecard', detail: 'Baselines, targets and misses, published.' },
      { id: 'maturity-published', label: 'Internal quarterly, maturity published', detail: 'The DMA score goes public each year; the rest is internal.' },
      { id: 'milestones-only', label: 'Milestone reporting', detail: 'Report against the roadmap, not outcome measures.' },
    ],
    sectionIds: ['measurement'],
  },
  {
    id: 'multiagency-lean',
    tier: 3,
    topic: 'Cross-agency',
    text: 'Lead the cross-agency joins now, or prove the education core first?',
    hint: 'Health, policing and welfare joins are where safeguarding value — and trust risk — concentrate.',
    kind: 'scale',
    scale: { left: 'Lead now — safeguarding cannot wait', right: 'Education core first — earn the right to join' },
    sectionIds: ['identifiers', 'legal-basis', 'commitments-obligations'],
  },
  {
    id: 'hundred-days',
    tier: 3,
    topic: 'First 100 days',
    text: 'What lands in the first 100 days?',
    kind: 'multi',
    pick: 3,
    options: [
      { id: 'publish-owners', label: 'Publish the strategy with named owners' },
      { id: 'ship-giveback', label: 'Ship one give-back product' },
      { id: 'identifier-pilot', label: 'Sign the identifier-pilot partnership' },
      { id: 'baseline-maturity', label: 'Baseline the maturity assessment' },
      { id: 'quality-slas', label: 'Quality SLAs on 5 critical datasets' },
      { id: 'dsa-fast-track', label: 'A data-sharing fast-track route' },
    ],
    sectionIds: ['delivery-roadmap'],
  },
  // ---- the free-text catch-all, in every set ----
  {
    id: 'anything-else',
    tier: 1,
    topic: 'In your words',
    text: 'Anything the strategy must say — in your own words?',
    hint: 'Commitments, anxieties, pet hates, a phrase you want kept. The generator will honour it.',
    kind: 'text',
    sectionIds: [],
  },
];

export const QUESTION_BY_ID: Record<string, InterviewQuestion> = Object.fromEntries(
  INTERVIEW_QUESTIONS.map((q) => [q.id, q]),
);

export function questionsForDepth(depth: DepthId): InterviewQuestion[] {
  const maxTier = depth === 'quick' ? 1 : depth === 'standard' ? 2 : 3;
  return INTERVIEW_QUESTIONS.filter((q) => q.tier <= maxTier);
}

// ---- the length skeletons ----

export interface SkeletonSection {
  /** Unique per skeleton; equals templateId where one applies. */
  id: string;
  templateId: string | null;
  title: string;
  words: number;
}

export const SKELETONS: Record<LengthId, SkeletonSection[]> = {
  concise: [
    { id: 'vision', templateId: 'vision', title: 'Vision & case for change', words: 380 },
    { id: 'users-needs', templateId: 'users-needs', title: 'Who this serves — and what they get back', words: 330 },
    { id: 'commitments-obligations', templateId: 'commitments-obligations', title: 'What we are already committed to', words: 350 },
    { id: 'architecture-platforms', templateId: 'architecture-platforms', title: 'The big shifts: identifier, spine, collections', words: 380 },
    { id: 'ethics-trust', templateId: 'ethics-trust', title: 'Trust, ethics & the legal footing', words: 330 },
    { id: 'delivery-roadmap', templateId: 'delivery-roadmap', title: 'Delivery, funding & sequencing', words: 330 },
    { id: 'measurement', templateId: 'measurement', title: 'How we will know it is working', words: 250 },
  ],
  working: [
    { id: 'vision', templateId: 'vision', title: 'Vision & case for change', words: 420 },
    { id: 'users-needs', templateId: 'users-needs', title: 'Users & their needs', words: 380 },
    { id: 'commitments-obligations', templateId: 'commitments-obligations', title: 'Commitments & obligations', words: 420 },
    { id: 'identifiers', templateId: 'identifiers', title: 'Identifiers & the single view', words: 420 },
    { id: 'architecture-platforms', templateId: 'architecture-platforms', title: 'Architecture & platforms', words: 450 },
    { id: 'standards-interoperability', templateId: 'standards-interoperability', title: 'Standards & interoperability', words: 380 },
    { id: 'data-quality', templateId: 'data-quality', title: 'Data quality & management', words: 400 },
    { id: 'governance-ownership', templateId: 'governance-ownership', title: 'Governance & ownership', words: 380 },
    { id: 'legal-basis', templateId: 'legal-basis', title: 'Legal basis & information rights', words: 380 },
    { id: 'ethics-trust', templateId: 'ethics-trust', title: 'Ethics, transparency & public trust', words: 380 },
    { id: 'delivery-roadmap', templateId: 'delivery-roadmap', title: 'Delivery roadmap', words: 450 },
    { id: 'measurement', templateId: 'measurement', title: 'Measuring the strategy', words: 340 },
  ],
  full: [
    { id: 'executive-summary', templateId: null, title: 'Executive summary', words: 350 },
    { id: 'vision', templateId: 'vision', title: 'Vision & case for change', words: 550 },
    { id: 'principles', templateId: 'principles', title: 'Principles', words: 350 },
    { id: 'users-needs', templateId: 'users-needs', title: 'Users & their needs', words: 500 },
    { id: 'commitments-obligations', templateId: 'commitments-obligations', title: 'Commitments & obligations', words: 550 },
    { id: 'architecture-platforms', templateId: 'architecture-platforms', title: 'Architecture & platforms', words: 600 },
    { id: 'standards-interoperability', templateId: 'standards-interoperability', title: 'Standards & interoperability', words: 480 },
    { id: 'identifiers', templateId: 'identifiers', title: 'Identifiers & the single view', words: 550 },
    { id: 'data-quality', templateId: 'data-quality', title: 'Data quality & management', words: 500 },
    { id: 'governance-ownership', templateId: 'governance-ownership', title: 'Governance & ownership', words: 450 },
    { id: 'legal-basis', templateId: 'legal-basis', title: 'Legal basis & information rights', words: 500 },
    { id: 'ethics-trust', templateId: 'ethics-trust', title: 'Ethics, transparency & public trust', words: 500 },
    { id: 'workforce-culture', templateId: 'workforce-culture', title: 'Workforce, skills & culture', words: 450 },
    { id: 'analytics-ai', templateId: 'analytics-ai', title: 'Analytics, AI & decisions', words: 500 },
    { id: 'open-data-research', templateId: 'open-data-research', title: 'Open data, research & the wider ecosystem', words: 420 },
    { id: 'security', templateId: 'security', title: 'Security & resilience', words: 400 },
    { id: 'delivery-roadmap', templateId: 'delivery-roadmap', title: 'Delivery roadmap', words: 600 },
    { id: 'funding', templateId: 'funding', title: 'Funding & sustainability', words: 450 },
    { id: 'measurement', templateId: 'measurement', title: 'Measuring the strategy', words: 450 },
  ],
};

export function wordBudget(length: LengthId): number {
  return SKELETONS[length].reduce((a, s) => a + s.words, 0);
}

// ---- the answer digest ----

function scaleReading(q: InterviewQuestion, value: number): string {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  if (!q.scale) return `${v}/100`;
  if (v <= 35) return `leans ${100 - v}% toward "${q.scale.left}"`;
  if (v >= 65) return `leans ${v}% toward "${q.scale.right}"`;
  return `deliberately balanced between "${q.scale.left}" and "${q.scale.right}"`;
}

/** One answered question → a grounded digest line (empty string if unanswered). */
export function digestAnswer(q: InterviewQuestion, a: InterviewAnswer | undefined): string {
  if (!a) return '';
  const parts: string[] = [];
  if (q.kind === 'scale' && typeof a.value === 'number') parts.push(scaleReading(q, a.value));
  if ((q.kind === 'single' || q.kind === 'multi') && a.optionIds?.length) {
    const labels = a.optionIds
      .map((id) => q.options?.find((o) => o.id === id))
      .filter(Boolean)
      .map((o) => `"${o!.label}"${o!.detail ? ` (${o!.detail})` : ''}`);
    if (labels.length) parts.push(`chose ${labels.join(' + ')}`);
  }
  const note = a.text?.trim();
  if (note) parts.push(`in their own words: "${note.slice(0, 600)}"`);
  if (!parts.length) return '';
  return `- **${q.topic}** — ${q.text} → ${parts.join('; ')}`;
}

/** The full digest, for the outline pass. */
export function digestAnswers(questions: InterviewQuestion[], answers: InterviewAnswer[]): string {
  const byId = new Map(answers.map((a) => [a.id, a]));
  return questions
    .map((q) => digestAnswer(q, byId.get(q.id)))
    .filter(Boolean)
    .join('\n');
}

/** The digest routed to one section: its own questions first, then the framing trio. */
export function digestForSection(templateId: string | null, questions: InterviewQuestion[], answers: InterviewAnswer[]): string {
  const byId = new Map(answers.map((a) => [a.id, a]));
  const FRAMING = new Set(['ambition', 'audience', 'big-bets', 'anything-else']);
  const own = questions.filter((q) => templateId !== null && q.sectionIds.includes(templateId) && !FRAMING.has(q.id));
  const framing = questions.filter((q) => FRAMING.has(q.id));
  const lines = [...own, ...framing].map((q) => digestAnswer(q, byId.get(q.id))).filter(Boolean);
  return lines.join('\n');
}
