// stories.ts — Field Study mastheads: each themed page declares its theme, driving
// question, thesis and "what data would we need to monitor this?" — the thread that
// ties every story back to the data-strategy purpose. Self-contained.

export interface Story {
  no: number;                 // Field Study number within the engine
  route: string;              // absolute href
  theme: string;              // one-line theme name
  question: string;           // the driving question (rendered as the h1)
  thesis: string;             // 1–2 sentence answer the page argues (research register)
  thesisEli5: string;         // same in plain English
  dataAsk: string[];          // bullets: what data we'd need to monitor this
}

export const STORIES: Record<string, Story> = {
  population: {
    no: 1, route: '/projects/policy-engine/population',
    theme: 'The human scale',
    question: 'What do these percentages mean in real children?',
    thesis: 'Rates hide magnitudes. Re-expressed as a synthetic cohort, a half-month change in the gap is tens of thousands of children — and, via LEO earnings linkage, a quantifiable lifetime economic return.',
    thesisEli5: 'Percentages hide how many real children are involved. This page turns every rate into actual kids — and into money the country gains or loses over their lifetimes.',
    dataAsk: [
      'Cohort-level linkage from school census through to earnings (LEO already proves this works at 38m-person scale)',
      'Per-pupil — not aggregate — outcome tracking, so headcounts, not just rates, are first-class',
    ],
  },
  regions: {
    no: 2, route: '/projects/policy-engine/regions',
    theme: 'The geography of inequality',
    question: 'Where does the disadvantage gap actually live?',
    thesis: 'The national gap decomposes into very different regional stories — London’s escape, the North East’s age-5-to-16 decay, the hidden coastal penalty. Place, not just poverty, carries a residual.',
    thesisEli5: 'The rich–poor gap is not the same everywhere. London mostly beat it; the North East loses ground as children age; seaside towns are quietly worst off.',
    dataAsk: [
      'Sub-regional (LA / constituency) outcome series with consistent disadvantage definitions',
      'Region-aware destination measures — the same child tracked across a regional move',
    ],
  },
  global: {
    no: 3, route: '/projects/policy-engine/global',
    theme: 'England against the world',
    question: 'Is England’s problem money, or how it’s spent?',
    thesis: 'PISA 2022 and OECD spending data say money alone doesn’t separate systems — equity does. England spends near the leaders but concentrates disadvantage harder than they do.',
    thesisEli5: 'Compared with other countries, England doesn’t spend unusually little — but poorer children here fall further behind than in the best systems.',
    dataAsk: [
      'Internationally comparable equity metrics refreshed between PISA cycles',
      'Spend-per-stage accounting (OECD cumulative age-6–15 basis) rather than headline budgets',
    ],
  },
  monitor: {
    no: 4, route: '/projects/policy-engine/monitor',
    theme: 'The data spine',
    question: 'How would we actually know if a policy worked?',
    thesis: 'England’s education data is rich but slow and siloed: a child’s record fragments across census, attendance, NCCIS, ILR and LEO, and the feedback loop runs in years, not terms. Monitoring is a design choice.',
    thesisEli5: 'We only find out if a policy worked years later, because the data about each child is split across systems that don’t talk to each other quickly.',
    dataAsk: [
      'A consistent child identifier across services (the CWS Act single-unique-identifier pilot)',
      'In-year feedback: the daily attendance feed shows near-real-time is possible — nothing equivalent exists post-16',
    ],
  },
  neet: {
    no: 5, route: '/projects/policy-engine/neet',
    theme: 'The early-warning system',
    question: 'A million young people are NEET. Could data have seen it coming?',
    thesis: 'The strongest NEET predictors — absence, EHCP, attainment — are visible in DfE’s own data years before age 16. The question isn’t whether to build early warning; it’s whether to do it credibly: weighted, validated against LEO, governed in the open.',
    thesisEli5: 'Most young people who end up with no job or training showed warning signs at school years earlier — in data the government already collects. The hard part is using it fairly.',
    dataAsk: [
      'A nationally validated risk index (NERI-style weights, tested against LEO 5-year outcomes)',
      'A post-16 participation signal faster than annual returns — the age-18 tracking dark zone closed',
      'Published precision/recall for any deployed model (none exists in England today)',
    ],
  },
};
