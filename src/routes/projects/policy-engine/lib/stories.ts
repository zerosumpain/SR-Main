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
  earlyYears: {
    no: 9, route: '/projects/policy-engine/early-years',
    theme: 'Before school begins',
    question: 'The gap is set before age 5. What is happening in the years we measure last?',
    thesis: 'Around 40% of the eventual age-16 disadvantage gap is already present at age 5, yet the first universal education measure of a child is taken at reception. The 0-5 period is acted on through levers but observed last: the largest new spending (the 30-hour offer) is structured to reach few disadvantaged children, the highest-return window carries the smallest per-child funding, and the pre-school developmental signal sits in health systems that do not connect to education.',
    thesisEli5: 'Most of the rich–poor gap is already there by the time children start school — but it is the part we measure last. The biggest new childcare money mostly helps better-off families, the years that matter most get the least targeted funding, and the early health checks never reach the school system.',
    dataAsk: [
      'A linked perinatal → age-2 development → age-5 GLD readout (ECHILD and Children of the 2020s prove it is constructible; nobody publishes it routinely)',
      'GLD and the disadvantage gap reported by deprivation decile early enough to act on, not only after reception',
      'Take-up of the disadvantaged 2-year-old offer joined to age-5 outcomes, to test whether access translates into development',
    ],
  },
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
  jigsaw: {
    no: 5, route: '/projects/policy-engine/jigsaw',
    theme: 'The information jigsaw',
    question: 'Who actually holds the picture of a child?',
    thesis: 'No single body does, and — for privacy reasons examined here — arguably none should. The picture of a child is distributed across school, council, NHS, police, courts and household systems by design. DfE is one holder among seventeen; serious-case reviews concentrate problems at the JOINS between holders, which currently lack a single accountable owner.',
    thesisEli5: 'No single organisation knows a child’s whole story: the school knows one part, the doctor another, the council a third. The serious failures tend to happen where those parts should meet but don’t — and joining them up is currently nobody’s defined job.',
    dataAsk: [
      'A cross-vendor safeguarding-record transfer standard — the richest record currently breaks at every school move',
      'A MASH data specification, with the new consistent identifier doing frontline matching rather than research-only linkage',
      'An endowed standards layer — iStandUK, SAVVI and Open Referral UK currently run on parish-newsletter grants',
    ],
  },
  send: {
    no: 7, route: '/projects/policy-engine/send',
    theme: 'The £12bn measurement gap',
    question: 'How did the costliest subsystem in education end up the least instrumented?',
    thesis: 'SEND is the system’s fastest-growing cost and its weakest feedback loop: statutory plans that were not visible at child level, limited data on provision delivered or outcomes by placement, and demand legible mainly through a tribunal that, of the appeals reaching a hearing, finds for families in about 99% of cases. The funding pressure is compounded by these data limitations.',
    thesisEli5: 'Special-needs support is the most expensive part of the school system — and the part with the least data. It is hard to see who is waiting, whether help arrives, or what works; one of the clearest signals is that tribunals, in the cases they hear, almost always side with families.',
    dataAsk: [
      'A machine-readable SEND record standard shipped WITH the new statutory digital ISPs — the artefact cancelled in 2025, finished under its new name',
      'Monthly EHCP pipeline reporting per LA, joined to the health-side autism/ADHD/SLT queues',
      'The placement-outcomes question made answerable: ECHILD-grade linkage + provision-delivered data, before the 2030 transition',
    ],
  },
  attendance: {
    no: 8, route: '/projects/policy-engine/attendance',
    theme: 'The leading indicator',
    question: 'England built the world’s best attendance instrument. Is it working?',
    thesis: 'Attendance is simultaneously the largest post-pandemic schooling problem — severe absence at a record 176,000 children — and the estate’s biggest data success: 99% of schools transmitting pupil-level data daily. What is missing is the loop: no independent evaluation of the instrument, no child-level early-warning use, and around half a million fines a year issued without a published causal evaluation of their effect.',
    thesisEli5: 'A record number of children miss more than half of school — yet attendance is the one thing the government now measures brilliantly, every school, every day. The missing piece: proof the measuring helps, and the nerve to use it child by child.',
    dataAsk: [
      'An independent causal evaluation of the daily feed, the similar-schools nudges and the fines framework — the natural experiments are already in the data',
      'Child-level trajectory flags (governed, published error rates, help-only) — the loop the school-level benchmarking stops short of',
      'The trust account settled: DPIA signed off, retention justified, families able to see their own child’s record',
    ],
  },
  neet: {
    no: 6, route: '/projects/policy-engine/neet',
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
