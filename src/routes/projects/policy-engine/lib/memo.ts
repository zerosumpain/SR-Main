// memo.ts — the capstone: a decision memo that synthesises every field study into
// one strategic artefact. The moves (ranked, grouped by what unlocks them), the
// missing-instruments register (every data ask on the site, deduped), the don'ts
// the history teaches, and the decision requested. Self-contained.

export const MEMO_META = {
  title: 'The synthesis',
  subtitle: 'What seven field studies add up to — the improvements to England’s children’s-data system with the highest leverage and the lowest cost, in one place.',
  bluf: {
    research: 'The pattern across all seven studies: the highest-leverage improvements are STEWARDSHIP functions — common standards, identity infrastructure, convening, and funding the connective tissue — rather than expanded central collection. Most of what is missing is specification and publication work over data the state already holds; the recurring failure mode, documented twice in the historical record, is building central machinery instead.',
    eli5: 'Across all seven studies, the same answer keeps appearing: the biggest improvements come from writing common rules, joining records up, and funding the small organisations that help everyone share — not from gathering more data into one place. Most of the fixes are cheap, because the data already exists.',
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
    research: 'England spends near the leaders (OECD cumulative basis) yet concentrates disadvantage harder than the systems it envies. The binding constraint is not the budget line; it is knowing where and for whom the system fails, soon enough to act.',
    eli5: 'We don’t spend unusually little. The best countries differ in how fairly outcomes are spread — and you can’t fix what you can’t see.',
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
    research: 'Absence, prior attainment and EHCP status — visible at age 13–14 in data DfE already holds — are the strongest predictors of the million-young-person NEET outcome. England runs a deterministic checklist (RONI) with no published error rates; the question is not whether to build early warning, but whether to do it credibly.',
    eli5: 'Most young people who end up out of work and education showed warning signs at school years earlier, in data the government already collects.',
    link: { label: 'Field Study №6 — NEET', href: '/projects/policy-engine/neet' },
  },
  {
    point: 'Counted as children rather than rates, the stakes are quantifiable — and unevenly placed.',
    research: 'A half-month move in the disadvantage gap is tens of thousands of real children, each carrying LEO-derived lifetime-earnings and exchequer consequences. And place carries a residual poverty does not explain: London’s escape, the North East’s decay, the coastal penalty.',
    eli5: 'Percentages hide real children — and real money over their lifetimes. Where a child grows up matters beyond how poor their family is.',
    link: { label: 'Field Studies №1–2 — Population & Regions', href: '/projects/policy-engine/population' },
  },
  {
    point: 'The costliest subsystem is also the least instrumented.',
    research: 'High-needs spending has risen 58% in real terms to £10.7bn while outcomes have not improved; deficits of £3–4.6bn (estimates disagree — itself a finding) sit behind an accounting override. Underneath: statutory-plan data that was child-invisible until 2023, 153 EHCP formats, no measure of provision delivered, and a tribunal ruling for families 99% of the time as the system’s only working feedback loop.',
    eli5: 'Special-needs support costs the most and is measured the least. The state doesn’t know who’s waiting, whether help arrives, or what works — and the courts rule against councils 99 times in 100.',
    link: { label: 'Field Study №7 — SEND', href: '/projects/policy-engine/send' },
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
    n: 1, title: 'Adopt the subsidiarity test as a standing gate', horizon: 'now', cost: '£',
    what: 'Every proposed collection answers four questions — does the decision live centrally? can the signal be learned without taking the data? what does the holder get back? what gets retired? — before it is approved. The test exists; make it procedure.',
    eli5: 'Before the centre demands new data, it must show the decision really is the centre’s to make — and give something back.',
    owner: 'DfE data & statistics directorate',
    evidence: { label: 'Monitoring — the subsidiarity test', href: '/projects/policy-engine/monitor' },
  },
  {
    n: 2, title: 'Write the two missing specifications', horizon: 'now', cost: '£',
    what: 'A cross-vendor safeguarding-record transfer standard (the CTF precedent, applied to the file it excluded), and — with the Home Office and NHS England — the MASH data specification. Both are unowned; both are specification work, not systems.',
    eli5: 'Write the common rules so the worry-file follows the child between schools, and so the emergency front door stops retyping names.',
    owner: 'DfE standards team + Home Office + NHSE',
    evidence: { label: 'Jigsaw — the switchboard', href: '/projects/policy-engine/jigsaw' },
  },
  {
    n: 3, title: 'Set the registers standard before fragmentation', horizon: 'now', cost: '£',
    what: 'One collection schema for the new children-not-in-school registers, with national de-duplication for children who move between LAs. 153 local formats are being born right now — the standard is cheap today and expensive in five years.',
    eli5: 'Every council is starting a list of children not in school. Agree one format now, before there are 153 different ones.',
    owner: 'DfE (CWS Act implementation)',
    evidence: { label: 'Jigsaw — registers, fused', href: '/projects/policy-engine/jigsaw' },
  },
  {
    n: 4, title: 'Endow the connective tissue', horizon: 'sr', cost: '£',
    what: 'A multi-year settlement for the standards and sector-tooling layer — iStandUK, SAVVI, Open Referral UK, the Data to Insight pattern — the way health endows the PRSB. Collectively less than one national IT procurement; currently funded in £190k rounds by a different department.',
    eli5: 'The tiny organisations that keep the common rules alive run on scraps. Fund them properly — it costs less than one big IT project.',
    owner: 'DfE + MHCLG (joint settlement)',
    evidence: { label: 'Jigsaw — the connective tissue', href: '/projects/policy-engine/jigsaw' },
  },
  {
    n: 5, title: 'Turn the attendance feed into an early-warning instrument', horizon: 'now', cost: '££',
    what: 'The estate’s newest, fastest asset is used to benchmark schools. Add individual trajectory flags — sudden deterioration in Years 9–11 pushed to LAs and careers leaders in-year — making attendance the hub of the NEET early-warning design.',
    eli5: 'The government already sees attendance daily. Use it to notice a child drifting away in time to act, not just to rank schools.',
    owner: 'DfE attendance + careers system',
    evidence: { label: 'NEET — attendance as the hub', href: '/projects/policy-engine/neet' },
  },
  {
    n: 6, title: 'Publish the tables the data already supports', horizon: 'now', cost: '£',
    what: 'Cohort-linked stage reporting (one real year-group followed through age 5 → 11 → 16 — the NPD already holds it); LA-level outcome series on consistent disadvantage definitions; destination measures that follow a child across a move; LEO earnings constants refreshed per cohort.',
    eli5: 'Several of the most useful statistics need no new data at all — just publishing what’s already in the database, joined up.',
    owner: 'DfE official statistics',
    evidence: { label: 'Population & Regions — the data asks', href: '/projects/policy-engine/population' },
  },
  {
    n: 13, title: 'Ship the SEND record standard with the ISP duty', horizon: 'now', cost: '£',
    what: 'The white paper puts a statutory digital Individual Support Plan into every nursery, school and college. Publish the machine-readable record standard BEFORE the duty commences — the cancelled 2023–25 digital-EHCP work is sitting in DfE’s own design history — or 153 EHCP formats become 153 ISP formats.',
    eli5: 'New digital support plans are coming anyway. Agree one format before every council invents its own — again.',
    owner: 'DfE SEND + standards team',
    evidence: { label: 'SEND — the information crisis', href: '/projects/policy-engine/send' },
  },
  {
    n: 7, title: 'Build identity resolution as shared infrastructure', horizon: 'identifier', cost: '£££',
    what: 'The consistent identifier exposed as a national matching service the MASH (and any authorised join) can call — the Wigan pilot’s lessons generalised; ECHILD-grade linkage moved from research-only to operations. The single most valuable join on the switchboard.',
    eli5: 'Build the “is this the same child?” service once, nationally, so every local team stops doing it by hand.',
    owner: 'DfE + NHSE (PDS) + DSIT',
    evidence: { label: 'Jigsaw — identity resolution', href: '/projects/policy-engine/jigsaw' },
  },
  {
    n: 8, title: 'Ship the Encompass-pattern flows', horizon: 'identifier', cost: '££',
    what: 'Push-based, deadline-bound, purpose-narrow notifications for the named joins: temporary accommodation → school, A&E attendance → DSL (the Cardiff Model’s minimum-data form), family-court milestones → social care. Each is one flow, not a database — the proven statutory template.',
    eli5: 'Copy the one flow that works (police warn the school by morning) for housing moves, hospital visits and court decisions.',
    owner: 'DfE convening MHCLG / NHSE / MoJ',
    evidence: { label: 'Jigsaw — the switchboard', href: '/projects/policy-engine/jigsaw' },
  },
  {
    n: 9, title: 'Close the age-18 dark zone', horizon: 'identifier', cost: '££',
    what: 'Near-real-time EET status for 16–24s from RTI/UC/ILR linkage — the join LEO already proves at research cadence, run operationally; plus an admin-data nowcast to corroborate the survey the ONS itself flags as volatile.',
    eli5: 'We stop tracking young people at 18, exactly when a million of them are out of work or education. The tax system already knows — connect it.',
    owner: 'DfE + DWP + HMRC',
    evidence: { label: 'NEET — the data estate', href: '/projects/policy-engine/neet' },
  },
  {
    n: 10, title: 'A validated risk index — governed in the open', horizon: 'identifier', cost: '££',
    what: 'Replace the unvalidated RONI checklist with nationally validated weights, tested against LEO five-year outcomes, with published precision/recall and an algorithmic transparency record — triage aid, never verdict. The Wisconsin failure and the Allegheny success differ in governance, not technology.',
    eli5: 'If the state scores children’s risk, the scoring must be tested, published and challengeable — used to offer help, never to label.',
    owner: 'DfE + What Works (Foundations)',
    evidence: { label: 'NEET — the tooling ladder', href: '/projects/policy-engine/neet' },
  },
  {
    n: 11, title: 'Flip FSM to auto-enrolment', horizon: 'sr', cost: '£',
    what: 'The DWP/HMRC eligibility pipe already runs; from September 2026 every Universal Credit household is eligible, making entitlement trivially inferable. Auto-enrolment feeds ~215,000 missed children and corrects the disadvantage measure beneath half the Department’s own statistics.',
    eli5: 'Stop making parents fill in forms the computer can already answer. Children get fed; the poverty statistics get honest.',
    owner: 'Policy decision (DfE + DWP)',
    evidence: { label: 'Jigsaw — FSM auto-enrolment', href: '/projects/policy-engine/jigsaw' },
  },
  {
    n: 12, title: 'Climb the sharing ladder instead of expanding extraction', horizon: 'sr', cost: '££',
    what: 'Build rung 4 — federated analytics over school and MIS data (an OpenSAFELY-for-schools) — rather than widening central collection; and write the evaluation-grade data clause (the “WKAR clause”) into edtech procurement frameworks so the shadow estate starts paying its evidence rent.',
    eli5: 'Learn from data where it lives instead of hoovering it up — and make edtech companies share what their products learn about what works.',
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
    name: 'Individual attendance early-warning flags',
    today: 'Daily feed used for school benchmarking only', target: 'Trajectory deterioration flags to LAs and careers leaders, in-year',
    owner: 'DfE attendance', cost: '£', study: { label: 'NEET · Monitoring', href: '/projects/policy-engine/neet' },
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
    title: 'Don’t build the central child database',
    why: 'ContactPoint (£224m) was dismantled in 2010 for reasons that have not changed; the Panel’s evidence says the failures are cultural as much as technical. Central custody of concern-level records is the road already travelled.',
    eli5: 'We built the giant database of every child once. It cost £224 million and was switched off. Don’t do it again.',
  },
  {
    title: 'Don’t add collections without retiring others',
    why: 'Registry-by-crisis (the RAAC questionnaire pattern) accretes burden and erodes the goodwill every flow on this site depends on. The subsidiarity test’s fourth question — what gets retired? — is the discipline.',
    eli5: 'Every time the centre asks schools and councils for something new, it should stop asking for something old.',
  },
  {
    title: 'Don’t nationalise the sector’s tooling',
    why: 'ChAT, Nexus and the analyst collectives work because the sector owns them. Fund them, standardise around them, and leave them owned by the people who use them — centre-funds-sector-owns is the proven counterweight.',
    eli5: 'Councils built good tools for themselves. Pay for them — don’t take them over.',
  },
  {
    title: 'Don’t score children in the dark',
    why: 'Wisconsin’s dropout algorithm ran for years with a ~74% false-alarm rate and no published validation; Allegheny’s governed triage aid narrowed racial disparities. The difference was governance and transparency, not the maths.',
    eli5: 'If a computer flags a child as “at risk”, the rules must be public, tested and used only to offer help.',
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
    ask: 'Two items are genuinely resource decisions — the connective-tissue endowment (single-digit £m/yr) and FSM auto-enrolment — while the identifier-dependent builds (improvements 7–10) are naturally sequenced by the CWS Act commencement timetable.',
    eli5: 'Two things cost real money and need a decision; the bigger technical builds simply queue behind the new child ID.',
  },
];

export const ONE_SENTENCE = {
  research: 'The recurring conclusion of the field studies: the centre adds most value as the system’s standards body, its identity infrastructure and its convenor — the steward of joins it never holds.',
  eli5: 'The evidence keeps pointing the same way: the centre helps most by making everyone’s data fit together, not by holding it all.',
};
