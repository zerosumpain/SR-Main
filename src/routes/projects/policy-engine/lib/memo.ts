// memo.ts — the capstone: a synthesis that draws every field study into one
// analytical summary. The identified improvements (ranked, grouped by what unlocks
// them), the missing-instruments register (every data ask on the site, deduped),
// what the historical record cautions against, and the suggested sequencing. Self-contained.

export const MEMO_META = {
  title: 'The synthesis',
  subtitle: 'What eight field studies add up to — the improvements to England’s children’s-data system with the highest leverage and the lowest cost, in one place.',
  bluf: {
    research: 'The pattern across all eight studies: the highest-leverage improvements are STEWARDSHIP functions — common standards, identity infrastructure, convening, and funding the connective tissue — rather than expanded central collection. Most of what is missing is specification and publication work over data the state already holds; the recurring failure mode, documented twice in the historical record, is building central machinery instead.',
    eli5: 'Across all eight studies, the same answer keeps appearing: the biggest improvements come from writing common rules, joining records up, and funding the small organisations that help everyone share — not from gathering more data into one place. Most of the fixes are cheap, because the data already exists.',
  },
};

// ---------------------------------------------------------------------------
// The case — five findings, one per thread of the project
// ---------------------------------------------------------------------------
export interface Finding {
  point: string;
  research: string;
  eli5: string;
  link: { label: string; href: string };
}

export const MEMO_CASE: Finding[] = [
  {
    point: 'Money alone does not separate systems — equity does.',
    research: 'England spends near the leaders (OECD cumulative basis) yet concentrates disadvantage more than the higher-equity systems it is compared against. On this evidence the binding constraint is not the budget line; it is knowing where and for whom the system underperforms, soon enough to act.',
    eli5: 'England does not spend unusually little. The higher-performing countries differ mainly in how evenly outcomes are spread — and a system cannot act on what it cannot see.',
    link: { label: 'Field Study №3 — Global', href: '/projects/policy-engine/global' },
  },
  {
    point: 'The feedback loop runs in years; the damage accrues in terms.',
    research: 'A child’s record fragments across census, attendance, NCCIS, ILR and LEO, and most of it reaches a decision-maker one to two years late. The daily attendance feed proves near-real-time is possible — it is used to benchmark schools, not to notice a child drifting.',
    eli5: 'We usually find out a policy failed years after it failed. Yet attendance now arrives daily — proof the slowness is a choice.',
    link: { label: 'Field Study №4 — Monitoring', href: '/projects/policy-engine/monitor' },
  },
  {
    point: 'The failures that harm children happen at the joins — and most joins are nobody’s job.',
    research: 'Lack of co-ordination or handover featured in 81% of the 330 serious safeguarding incidents the national Panel reviewed. Of the ten information jobs the system must do, three have no accountable owner: know every child exists, move the record when the child moves, set the standards.',
    eli5: 'In four of five of the worst cases, services failed to join up what they each knew. Nobody is officially in charge of the joining.',
    link: { label: 'Field Study №5 — The Jigsaw', href: '/projects/policy-engine/jigsaw' },
  },
  {
    point: 'The predictors are already in the Department’s own data, years early.',
    research: 'Absence, prior attainment and EHCP status — visible at age 13–14 in data DfE already holds — are the strongest predictors of the million-young-person NEET outcome. The Milburn review (2026) reframes the scale ("the fork in the road": ~£125bn/yr, £1 of youth support per ~£25 of benefits) and locates the failure across the youth economy, health, welfare and an architecture that is "a system in name, not in design". England runs a deterministic checklist (RONI) with no published error rates; the question is not whether to build early warning, but whether to do it credibly — and whether anyone owns the cross-department join.',
    eli5: 'Most young people who end up out of work and education showed warning signs at school years earlier, in data the government already collects.',
    link: { label: 'Field Study №6 — NEET', href: '/projects/policy-engine/neet' },
  },
  {
    point: 'Counted as children rather than rates, the stakes are quantifiable — and unevenly placed.',
    research: 'A half-month move in the disadvantage gap is tens of thousands of children, each carrying LEO-derived lifetime-earnings and exchequer consequences. And place carries a residual that poverty does not explain: London’s above-trend outcomes, the North East’s decline, the coastal-area shortfall.',
    eli5: 'Percentages hide real children — and real money over their lifetimes. Where a child grows up matters beyond how poor their family is.',
    link: { label: 'Field Studies №1–2 — Population & Regions', href: '/projects/policy-engine/population' },
  },
  {
    point: 'The costliest subsystem is also the least instrumented.',
    research: 'High-needs spending has risen 58% in real terms to £10.7bn while outcomes have not improved; deficits of £3–4.6bn (estimates disagree — itself a finding) sit behind an accounting override. Underneath: statutory-plan data that was child-invisible until 2023, 153 EHCP formats, no measure of provision delivered, and a tribunal ruling for families 99% of the time as the system’s only working feedback loop.',
    eli5: 'Special-needs support costs the most and is measured the least. The state doesn’t know who’s waiting, whether help arrives, or what works — and the courts rule against councils 99 times in 100.',
    link: { label: 'Field Study №7 — SEND', href: '/projects/policy-engine/send' },
  },
  {
    point: 'The estate’s best instrument exists — and its impact is unproven.',
    research: 'Attendance shows what good looks like: 99% of schools transmitting pupil-level data daily, statistics published fortnightly. It also shows the gap that remains: severe absence at a record despite the instrument, government attribution claims with no independent evaluation, half a million penalty notices a year issued without evidence they work, and a feed used to benchmark schools rather than to notice a child drifting.',
    eli5: 'The daily attendance data proves brilliant measurement is possible. It also proves measurement alone isn’t enough — the deepest absence problem is still growing, and nobody has tested whether the tools or the fines actually work.',
    link: { label: 'Field Study №8 — Attendance', href: '/projects/policy-engine/attendance' },
  },
];

// ---------------------------------------------------------------------------
// The moves — ranked, grouped by what unlocks them
// ---------------------------------------------------------------------------
export type Horizon = 'now' | 'identifier' | 'sr';

export const HORIZON_META: Record<Horizon, { label: string; eli5: string; colour: string }> = {
  now:        { label: 'No new law or collection needed', eli5: 'Could start any time', colour: '#2f6f97' },
  identifier: { label: 'Enabled by the identifier (CWS Act 2026)', eli5: 'Possible once the new child ID arrives', colour: '#9a7b1f' },
  sr:         { label: 'Requires a funding or policy decision', eli5: 'Needs a money decision first', colour: '#7a5aa6' },
};

export interface Move {
  n: number;
  title: string;
  what: string;
  eli5: string;
  owner: string;
  cost: '£' | '££' | '£££';
  horizon: Horizon;
  evidence: { label: string; href: string };
}

export const MOVES: Move[] = [
  {
    n: 1, title: 'The subsidiarity test as a standing gate', horizon: 'now', cost: '£',
    what: 'A criterion that can be applied to every proposed collection via four questions — does the decision live centrally? can the signal be learned without taking the data? what does the holder get back? what gets retired? The test already exists; applying it as routine procedure requires no new law or collection.',
    eli5: 'A check that can be applied before the centre requests new data: does the decision actually sit with the centre, and what does the data holder get back?',
    owner: 'DfE data & statistics directorate',
    evidence: { label: 'Monitoring — the subsidiarity test', href: '/projects/policy-engine/monitor' },
  },
  {
    n: 2, title: 'The two missing specifications', horizon: 'now', cost: '£',
    what: 'A cross-vendor safeguarding-record transfer standard (the CTF precedent, applied to the file it excluded), and — with the Home Office and NHS England — the MASH data specification. Both are currently unowned; both are specification work, not systems.',
    eli5: 'Common rules so the safeguarding file follows the child between schools, and so the emergency front door stops re-entering names.',
    owner: 'DfE standards team + Home Office + NHSE',
    evidence: { label: 'Jigsaw — the switchboard', href: '/projects/policy-engine/jigsaw' },
  },
  {
    n: 3, title: 'The registers standard, before fragmentation', horizon: 'now', cost: '£',
    what: 'One collection schema for the new children-not-in-school registers, with national de-duplication for children who move between LAs. 153 local formats are being created now — setting the standard early is low-cost; retrofitting it across 153 formats later is not.',
    eli5: 'Every council is starting a list of children not in school. A single agreed format now avoids 153 different ones later.',
    owner: 'DfE (CWS Act implementation)',
    evidence: { label: 'Jigsaw — registers, fused', href: '/projects/policy-engine/jigsaw' },
  },
  {
    n: 4, title: 'Funding the connective tissue', horizon: 'sr', cost: '£',
    what: 'A multi-year settlement for the standards and sector-tooling layer — iStandUK, SAVVI, Open Referral UK, the Data to Insight pattern — comparable to how health funds the PRSB. Collectively less than one national IT procurement; currently funded in £190k rounds by a different department.',
    eli5: 'The small organisations that maintain the common rules are funded in short rounds. A stable settlement would cost less than one large IT project.',
    owner: 'DfE + MHCLG (joint settlement)',
    evidence: { label: 'Jigsaw — the connective tissue', href: '/projects/policy-engine/jigsaw' },
  },
  {
    n: 5, title: 'The attendance feed as an early-warning instrument', horizon: 'now', cost: '££',
    what: 'The estate’s newest, fastest asset is currently used to benchmark schools. Adding individual trajectory flags — sudden deterioration in Years 9–11, surfaced to LAs and careers leaders in-year — would make attendance the hub of the NEET early-warning design.',
    eli5: 'The government already receives attendance daily. The same feed could surface a child disengaging in time to act, rather than serving only to rank schools.',
    owner: 'DfE attendance + careers system',
    evidence: { label: 'Attendance — closing the loop', href: '/projects/policy-engine/attendance' },
  },
  {
    n: 6, title: 'The tables the data already supports', horizon: 'now', cost: '£',
    what: 'Cohort-linked stage reporting (one real year-group followed through age 5 → 11 → 16 — the NPD already holds it); LA-level outcome series on consistent disadvantage definitions; destination measures that follow a child across a move; LEO earnings constants refreshed per cohort.',
    eli5: 'Several of the most useful statistics need no new data at all — only publishing what is already in the database, joined up.',
    owner: 'DfE official statistics',
    evidence: { label: 'Population & Regions — the data asks', href: '/projects/policy-engine/population' },
  },
  {
    n: 13, title: 'The SEND record standard, with the ISP duty', horizon: 'now', cost: '£',
    what: 'The white paper puts a statutory digital Individual Support Plan into every nursery, school and college. Publishing the machine-readable record standard before the duty commences — the cancelled 2023–25 digital-EHCP work sits in DfE’s own design history — is what would prevent 153 EHCP formats becoming 153 ISP formats.',
    eli5: 'New digital support plans are coming. Agreeing one format before the duty starts avoids every council creating its own again.',
    owner: 'DfE SEND + standards team',
    evidence: { label: 'SEND — the information gap', href: '/projects/policy-engine/send' },
  },
  {
    n: 7, title: 'Identity resolution as shared infrastructure', horizon: 'identifier', cost: '£££',
    what: 'The consistent identifier exposed as a national matching service the MASH (and any authorised join) can call — the Wigan pilot’s lessons generalised; ECHILD-grade linkage moved from research-only to operations. The highest-value join on the switchboard.',
    eli5: 'An “is this the same child?” service built once, nationally, so local teams no longer do it by hand.',
    owner: 'DfE + NHSE (PDS) + DSIT',
    evidence: { label: 'Jigsaw — identity resolution', href: '/projects/policy-engine/jigsaw' },
  },
  {
    n: 8, title: 'The Encompass-pattern flows', horizon: 'identifier', cost: '££',
    what: 'Push-based, deadline-bound, purpose-narrow notifications for the named joins: temporary accommodation → school, A&E attendance → DSL (the Cardiff Model’s minimum-data form), family-court milestones → social care. Each is one flow, not a database — the proven statutory template.',
    eli5: 'Extending the one flow that works (police notify the school by morning) to housing moves, hospital visits and court decisions.',
    owner: 'DfE convening MHCLG / NHSE / MoJ',
    evidence: { label: 'Jigsaw — the switchboard', href: '/projects/policy-engine/jigsaw' },
  },
  {
    n: 9, title: 'Closing the age-18 tracking gap', horizon: 'identifier', cost: '££',
    what: 'Near-real-time EET status for 16–24s from RTI/UC/ILR linkage — the join LEO already proves at research cadence, run operationally; plus an admin-data nowcast to corroborate the survey the ONS itself flags as volatile.',
    eli5: 'Tracking currently stops at 18, the point at which around a million young people are out of work or education. The tax system already holds the status — linking it would close the gap.',
    owner: 'DfE + DWP + HMRC',
    evidence: { label: 'NEET — the data estate', href: '/projects/policy-engine/neet' },
  },
  {
    n: 10, title: 'A validated risk index — governed in the open', horizon: 'identifier', cost: '££',
    what: 'Replacing the unvalidated RONI checklist with nationally validated weights, tested against LEO five-year outcomes, with published precision/recall and an algorithmic transparency record — functioning as a triage aid, not a verdict. The Wisconsin and Allegheny cases differ in governance, not technology.',
    eli5: 'Where the state scores children’s risk, the evidenced condition for it working is that the scoring is tested, published and challengeable — used to offer help rather than to label.',
    owner: 'DfE + What Works (Foundations)',
    evidence: { label: 'NEET — the tooling ladder', href: '/projects/policy-engine/neet' },
  },
  {
    n: 11, title: 'FSM auto-enrolment', horizon: 'sr', cost: '£',
    what: 'The DWP/HMRC eligibility pipe already runs; from September 2026 every Universal Credit household is eligible, making entitlement readily inferable. Auto-enrolment would reach ~215,000 currently-missed children and correct the disadvantage measure beneath about half the Department’s own statistics.',
    eli5: 'Auto-enrolment removes a form the data can already complete: more eligible children are fed, and the poverty statistics become more accurate.',
    owner: 'Policy decision (DfE + DWP)',
    evidence: { label: 'Jigsaw — FSM auto-enrolment', href: '/projects/policy-engine/jigsaw' },
  },
  {
    n: 12, title: 'The sharing ladder, instead of expanding extraction', horizon: 'sr', cost: '££',
    what: 'Building rung 4 — federated analytics over school and MIS data (an OpenSAFELY-for-schools) — rather than widening central collection; and writing the evaluation-grade data clause (the “WKAR clause”) into edtech procurement frameworks so the shadow estate contributes evidence on what works.',
    eli5: 'Analysing data where it is held rather than collecting it centrally — and requiring edtech products to share what they reveal about what works.',
    owner: 'DfE digital + procurement',
    evidence: { label: 'Monitoring — the ladder & the shadow estate', href: '/projects/policy-engine/monitor' },
  },
];

// ---------------------------------------------------------------------------
// Annex A — the missing-instruments register (every data ask, deduped)
// ---------------------------------------------------------------------------
export interface Instrument {
  name: string;
  today: string;     // the instrument's current state
  target: string;    // what better looks like
  owner: string;
  cost: '£' | '££' | '£££';
  study: { label: string; href: string };
}

export const INSTRUMENTS: Instrument[] = [
  {
    name: 'Safeguarding-record transfer standard',
    today: 'The richest record breaks at every school move; 5-day manual duty, vendor lock', target: 'Cross-vendor transfer in days, spine as address book only',
    owner: 'DfE standards', cost: '£', study: { label: 'Jigsaw', href: '/projects/policy-engine/jigsaw' },
  },
  {
    name: 'MASH data specification + identity matching',
    today: 'Front-door triage re-keys the same child between three screens', target: 'Machine-resolved identity; a national spec for the fused picture',
    owner: 'DfE + HO + NHSE', cost: '££', study: { label: 'Jigsaw', href: '/projects/policy-engine/jigsaw' },
  },
  {
    name: 'Children-not-in-school registers schema',
    today: '153 local registers being born in 153 formats; no cross-LA de-dup', target: 'One schema; a child who moves councils stays one child',
    owner: 'DfE (CWS Act)', cost: '£', study: { label: 'Jigsaw', href: '/projects/policy-engine/jigsaw' },
  },
  {
    name: 'Post-16 participation signal & NEET nowcast',
    today: 'Tracking goes dark at 18; the headline rests on a survey with volatility warnings', target: 'RTI/UC/ILR-linked EET status, near-real-time, corroborating the survey',
    owner: 'DfE + DWP + HMRC', cost: '££', study: { label: 'NEET', href: '/projects/policy-engine/neet' },
  },
  {
    name: 'Cross-department youth-participation view',
    today: 'NEET status fragments across DfE, DWP, HMRC and NHS; the labour-DEMAND side (entry-level vacancies, work experience) is unmeasured, so the £1:£25 support-vs-benefits split is invisible',
    target: 'A joined 16–24 EET + entry-level-vacancy signal and spend-per-stage accounting — the participation-by-design data ask (Milburn ch.7: "a system in name, not in design")',
    owner: 'DfE + DWP + HMRC + NHSE', cost: '££', study: { label: 'NEET', href: '/projects/policy-engine/neet' },
  },
  {
    name: 'Individual attendance early-warning flags',
    today: 'Daily feed used for school benchmarking only; severe absence rising while the rest improves', target: 'Trajectory deterioration flags to LAs and careers leaders, in-year — governed, error rates published',
    owner: 'DfE attendance', cost: '£', study: { label: 'Attendance', href: '/projects/policy-engine/attendance' },
  },
  {
    name: 'Evaluation of the attendance instrument & fines',
    today: 'Impact attributed by press release; the only intervention evaluation is uncontrolled; 492,800 notices/yr never evaluated', target: 'An independent causal programme exploiting the rollout and regional enforcement variation already in the data',
    owner: 'DfE + EEF/Foundations', cost: '£', study: { label: 'Attendance', href: '/projects/policy-engine/attendance' },
  },
  {
    name: 'Published error rates for any deployed risk model',
    today: 'RONI runs nationally with no published precision/recall', target: 'LEO-validated weights + an algorithmic transparency record',
    owner: 'DfE + Foundations', cost: '££', study: { label: 'NEET', href: '/projects/policy-engine/neet' },
  },
  {
    name: 'Cohort-linked stage reporting',
    today: 'Age 5 / 11 / 16 published separately; no real cohort followed through', target: 'One year-group through all three gates — the NPD already holds it',
    owner: 'DfE statistics', cost: '£', study: { label: 'Population', href: '/projects/policy-engine/population' },
  },
  {
    name: 'Refreshed LEO earnings constants',
    today: 'Lifetime-return figures calibrated on 2002–05 GCSE cohorts', target: 'Per-cohort refresh with regional splits — the linkage exists',
    owner: 'DfE statistics', cost: '£', study: { label: 'Population', href: '/projects/policy-engine/population' },
  },
  {
    name: 'Place series that follow the child',
    today: 'A child who moves region vanishes from one column, reappears in another', target: 'LA-level consistent-definition series + cross-move destination measures',
    owner: 'DfE statistics', cost: '£', study: { label: 'Regions', href: '/projects/policy-engine/regions' },
  },
  {
    name: 'Between-cycle equity measure',
    today: 'Fairness is a once-every-three-years PISA number, England blended into the UK', target: 'National equity sampling tied to the PISA scales, between cycles',
    owner: 'DfE + OECD liaison', cost: '££', study: { label: 'Global', href: '/projects/policy-engine/global' },
  },
  {
    name: 'EHCP assessment-pipeline reporting',
    today: 'Annual January snapshot; the queue of waiting families barely published; no national ADHD wait count exists at all', target: 'Monthly pipeline per LA, joined to the health-side assessment queues',
    owner: 'DfE SEND + NHSE', cost: '£', study: { label: 'SEND', href: '/projects/policy-engine/send' },
  },
  {
    name: 'Child-level SEND record standard (ISP/EHCP)',
    today: '153 LA templates; the standardised digital EHCP cancelled in 2025 (“never completed”)', target: 'One machine-readable standard, shipped with the statutory ISP duty',
    owner: 'DfE SEND + standards', cost: '£', study: { label: 'SEND', href: '/projects/policy-engine/send' },
  },
  {
    name: 'Provision-delivered & placement-outcomes data',
    today: 'No collection records what a plan delivers or how placements compare; the white paper’s inclusion claim rests on contested comparisons', target: 'ISP-collected delivery data + an ECHILD-grade placement-outcomes study before the 2030 transition',
    owner: 'DfE + ADR UK', cost: '££', study: { label: 'SEND', href: '/projects/policy-engine/send' },
  },
  {
    name: 'In-year high-needs spend visibility',
    today: 'DSG deficits in accounts a year+ late, held off-book by the statutory override; estimates of the national deficit disagree by £1.5bn', target: 'Quarterly high-needs spend vs budget by LA, published',
    owner: 'DfE + MHCLG', cost: '£', study: { label: 'SEND', href: '/projects/policy-engine/send' },
  },
  {
    name: 'Termly teacher-vacancy signal',
    today: 'Counted each November, published the following June', target: 'Termly vacancy reporting via the MIS pipe that already carries attendance',
    owner: 'DfE workforce', cost: '£', study: { label: 'The Briefing', href: '/projects/policy-engine/outcomes' },
  },
];

// ---------------------------------------------------------------------------
// The don'ts — what the history teaches
// ---------------------------------------------------------------------------
export const MEMO_DONTS: { title: string; why: string; eli5: string }[] = [
  {
    title: 'The central child database',
    why: 'ContactPoint (£224m) was dismantled in 2010 for reasons that have not changed; the Panel’s evidence indicates the failures are cultural as much as technical. Central custody of concern-level records is an approach already attempted and withdrawn.',
    eli5: 'A single national database of every child was built once. It cost £224 million and was decommissioned — a precedent the record cautions against repeating.',
  },
  {
    title: 'Adding collections without retiring others',
    why: 'Registry-by-crisis (the RAAC questionnaire pattern) accumulates burden and erodes the goodwill the flows on this site depend on. The subsidiarity test’s fourth question — what gets retired? — addresses this.',
    eli5: 'On the record, new requests to schools and councils that do not retire an old one accumulate burden over time.',
  },
  {
    title: 'Nationalising the sector’s tooling',
    why: 'ChAT, Nexus and the analyst collectives function in part because the sector owns them. The pattern the record favours is centre-funds-sector-owns: fund and standardise around them while ownership stays with the users.',
    eli5: 'Councils built effective tools themselves. The pattern that has worked is funding them rather than taking them over.',
  },
  {
    title: 'Scoring children without published validation',
    why: 'Wisconsin’s dropout algorithm ran for years with a ~74% false-alarm rate and no published validation; Allegheny’s governed triage aid narrowed racial disparities. The difference was governance and transparency, not the modelling.',
    eli5: 'Where a computer flags a child as “at risk”, the evidenced condition for it working is that the rules are public, tested and used only to offer help.',
  },
];

// ---------------------------------------------------------------------------
// Sequencing — what the analysis suggests comes first
// ---------------------------------------------------------------------------
export const DECISIONS: { ask: string; eli5: string }[] = [
  {
    ask: 'The posture question comes before any individual build: whether the centre’s data role is collector or steward determines the design of everything else, and the subsidiarity test is the practical form of that choice.',
    eli5: 'First settle the job description — rule-writer and join-maker, or data gatherer — because everything else follows from it.',
  },
  {
    ask: 'The reversible, low-cost items stand on their own merits regardless of wider reform: the safeguarding-transfer and MASH specifications, the registers schema, the attendance early-warning use, and publications over data already held (improvements 1–3, 5–6, 13).',
    eli5: 'The cheap, safe items don’t need to wait for anything — they’re mostly writing rules and publishing what already exists.',
  },
  {
    ask: 'Two items are resource decisions — the connective-tissue settlement (single-digit £m/yr) and FSM auto-enrolment — while the identifier-dependent builds (improvements 7–10) are sequenced by the CWS Act commencement timetable.',
    eli5: 'Two things cost real money and need a decision; the bigger technical builds simply queue behind the new child ID.',
  },
];

export const ONE_SENTENCE = {
  research: 'The recurring conclusion of the field studies: the centre adds most value as the system’s standards body, its identity infrastructure and its convenor — the steward of joins it never holds.',
  eli5: 'The evidence keeps pointing the same way: the centre helps most by making everyone’s data fit together, not by holding it all.',
};
