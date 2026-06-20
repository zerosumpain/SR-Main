// globalIntel.ts — the benchmarking-intelligence layer for the Global field study:
// the borrowing ledger (what England imported, with evaluated verdicts), how serious
// systems respond to the scoreboard, England's anti-pattern record, and the next
// readouts. Research dossier compiled 2026-06-10; claims carry sources. Self-contained.

// ---------------------------------------------------------------------------
// 4 · The borrowing ledger
// ---------------------------------------------------------------------------
export type BorrowVerdict = 'evaluated-null' | 'evaluated-small' | 'claimed' | 'export' | 'non-import';

export const VERDICT_META: Record<BorrowVerdict, { label: string; eli5: string; colour: string }> = {
  'evaluated-null':  { label: 'evaluated: no effect found', eli5: 'tested — didn’t work as hoped', colour: '#b1455e' },
  'evaluated-small': { label: 'evaluated: small positive',  eli5: 'tested — helps a little',       colour: '#b4632e' },
  claimed:           { label: 'credited, not evaluated',    eli5: 'praised but never tested',      colour: '#9a7b1f' },
  export:            { label: 'became an export',           eli5: 'others copied it from us',      colour: '#2f7d4f' },
  'non-import':      { label: 'the non-import',             eli5: 'we looked, and didn’t copy',    colour: '#7a5aa6' },
};

export interface Borrowing {
  name: string;
  from: string;
  when: string;
  verdict: BorrowVerdict;
  what: string;
  outcome: string;
  lesson: string;
  url: string;
}

export const BORROWINGS: Borrowing[] = [
  {
    name: 'Teaching for Mastery (maths)', from: 'Shanghai · Singapore', when: '2014–today', verdict: 'evaluated-null',
    what: 'England’s biggest deliberate import: the Shanghai teacher exchange, 40 Maths Hubs, NCETM’s mastery programme and Singapore-derived textbook subsidies — £41m announced for 8,000 primaries in 2016, well over £100m since.',
    outcome: 'The DfE’s own Sheffield Hallam evaluation: NO quantifiable KS2 attainment effect from the exchange; EEF trials of Ark’s Mathematics Mastery found ~+1 month. England’s TIMSS 2023 was strong — and is credited to mastery without causal evidence. The first RCT of the flagship NCETM programme itself only began in 2025/26, a decade and >£100m in.',
    lesson: 'Scale ran ahead of evaluation for ten years. Import the evaluation discipline before the pedagogy.',
    url: 'https://assets.publishing.service.gov.uk/media/5c49b38340f0b61717193d2d/MTE_main_report.pdf',
  },
  {
    name: 'Systematic synthetic phonics', from: 'Home-grown (international evidence base)', when: '2006–today', verdict: 'evaluated-small',
    what: 'The Rose Review settlement: mandatory SSP, the Year 1 screening check (2012), Reading Ambition — domestic policy built on the international experimental literature rather than copied from a country.',
    outcome: 'England rose to 4th of 43 in PIRLS 2021, its best ever, with gains concentrated among the weakest readers. The honest caveat: England’s score was essentially flat (559→558) — the rankings rise was largely others falling plus COVID-disrupted testing windows.',
    lesson: 'England’s best scoreboard story — and even it shows how rankings flatter: read scores, not positions.',
    url: 'https://www.gov.uk/government/news/england-moves-to-fourth-in-international-rankings-for-reading',
  },
  {
    name: 'T Levels', from: 'Germany · Netherlands · Austria · Denmark', when: '2016–today', verdict: 'claimed',
    what: 'The Sainsbury Panel explicitly benchmarked continental technical systems — including their ~16–37% higher per-student technical funding and dual-system employer institutions.',
    outcome: 'The qualification architecture was borrowed; the funding levels, employer institutions and labour-market linkages were not. NAO: recruitment far below forecast, high dropout.',
    lesson: 'A qualification is the visible tip of a system. Borrowing the certificate without the institutions underneath it transplants the form, not the function.',
    url: 'https://www.nao.org.uk/reports/investigation-into-introducing-t-levels/',
  },
  {
    name: 'Teach First', from: 'Teach for America (US)', when: '2002–today', verdict: 'export',
    what: 'A direct import of Wendy Kopp’s 1990 model — elite-graduate recruitment into challenging schools.',
    outcome: 'Became an export platform itself: Teach First co-founded the global Teach For All network in 2007. London Challenge similarly travelled (Schools Challenge Cymru), though imitators often lacked the political mandate that made the original work.',
    lesson: 'England can export as well as import — the successful transfers carried their delivery institutions with them.',
    url: 'https://www.instituteforgovernment.org.uk/sites/default/files/publications/Implementing%20the%20London%20Challenge%20-%20final_0.pdf',
  },
  {
    name: 'The Finland non-import', from: 'Finland', when: '2000s–2010s', verdict: 'non-import',
    what: 'Ministers toured the era’s PISA darling repeatedly — a system with no national tests before upper secondary, no league tables, no English-style inspection, and trust-based professionalism.',
    outcome: 'England took almost nothing structural and moved in the opposite direction on every accountability axis — while importing Singapore’s textbooks the same decade.',
    lesson: 'Borrowing is ideologically filtered: systems import what confirms their priors. An honest benchmarking function looks hardest at the evidence it likes least.',
    url: 'https://re-state.co.uk/rethink/bolder-moves-for-education-lessons-from-finland/',
  },
];

export const BORROW_CAUTION = {
  research: 'The policy-borrowing literature’s standing warning: league-table data is correlational, yet consultancies and governments convert it into decontextualised “best practice” packages (Auld & Morris); Sahlberg’s “GERM” spreads standardisation and high-stakes accountability through exactly this channel. The empirical kicker from the 2025 systematic-review literature: two decades of PISA-led reform have not broadly improved system-level performance across the OECD.',
  eli5: 'The trap: a country does well in the tests, everyone copies one visible thing it does, and the copy rarely works — because what made it work was the system around it. Twenty years of countries copying each other this way hasn’t made results better overall.',
};

// ---------------------------------------------------------------------------
// 5 · How serious systems respond to the scoreboard
// ---------------------------------------------------------------------------
export interface SystemResponse {
  flag: string;
  country: string;
  pattern: string;       // the named response pattern
  story: string;
  lesson: string;
  colour: string;
  url: string;
}

export const RESPONSES: SystemResponse[] = [
  {
    flag: 'DE', country: 'Germany', pattern: 'Institutionalise, then renew', colour: '#2f6f97',
    story: 'The archetypal “PISA shock” (2001, below OECD average): the response was institutional — binding national standards (2003–04) and the IQB monitoring institute (2004), plus language support and full-day schooling. Germany improved to ~2012, then decayed to its lowest-ever scores in PISA 2022 — same diagnosis as 2001. The 2024 answer: the €20bn, ten-year Startchancen programme for ~4,000 disadvantaged schools, with an IEA evaluation built in from day one.',
    lesson: 'Reforms decay. The response function must be a permanent institution, not a one-off shock reaction — and Germany’s second response targets equity, not rankings.',
    url: 'https://www.bmbf.de/EN/Education/School/StartchancenProgramme/startchancenprogramme.html',
  },
  {
    flag: 'PL', country: 'Poland', pattern: 'Gains undone by politics', colour: '#b1455e',
    story: 'The 1999 reform (delayed tracking, the gimnazjum, national exams) took Poland from below-average to top-10 by PISA 2012. The 2016 government abolished the gimnazjum and restored earlier tracking; Poland’s PISA 2022 fall was roughly twice the OECD average in reading and maths, three times in science.',
    lesson: 'The cleanest natural experiment in benchmarked gains being reversed by political churn — the cautionary tale for every reform without cross-party settlement.',
    url: 'https://link.springer.com/chapter/10.1007/978-3-030-59031-4_7',
  },
  {
    flag: 'JP', country: 'Japan', pattern: 'Precise correction', colour: '#3f7d6e',
    story: 'The yutori (“relaxed education”) curriculum collided with PISA 2003/06 falls; MEXT diagnosed precisely, restored content and hours, and built an annual national assessment (2007). Back to the global top by 2009 — and one of the few systems that ROSE in PISA 2022.',
    lesson: 'A system with institutional memory metabolises a bad result into a targeted correction rather than structural churn.',
    url: 'https://www.oecd.org/content/dam/oecd/en/publications/reports/2011/09/education-reform-in-japan_g17a200a/5kg58z7g95np-en.pdf',
  },
  {
    flag: 'EE', country: 'Estonia', pattern: 'Standing data governance', colour: '#9a7b1f',
    story: 'Europe’s top performer with unusually small socio-economic gaps — and no famous “PISA response” at all. The distinctive feature is permanent infrastructure: the national education information system, e-school platforms, and a 2021–2035 strategy horizon.',
    lesson: 'The quiet exemplar: benchmarking as continuous instrumentation, not episodic panic.',
    url: 'https://www.oecd.org/content/dam/oecd/en/publications/reports/2021/11/enhancing-data-informed-strategic-governance-in-education-in-estonia_3f763a1b/11495e02-en.pdf',
  },
];

export const ANTIPATTERN = {
  title: 'England’s own record — the anti-pattern, documented',
  research: 'The 2010s “plummeting” narrative (4th→16th, 7th→25th, 8th→28th) drew a formal UK Statistics Authority rebuke: the OECD itself had ruled the UK’s PISA 2000/03 baselines statistically invalid (response-rate failures — England was excluded from PISA 2003 reporting altogether). It recurred in 2022: the UK again missed PISA’s technical standards, and the OECD’s own bias analysis suggests England’s means may be inflated by ~7–8 points. Meanwhile England WITHDREW from TALIS 2024 — the teacher-workforce benchmark — citing data-collection burden, over union and OECD objections. The pattern: loud use of rankings for reform narratives, quiet weakness on participation discipline.',
  eli5: 'England’s record is the cautionary tale: ministers once claimed we’d “plummeted” using numbers the statistics watchdog said were invalid; our 2022 results may be flattered because too few schools took part; and we quit the big international teacher survey entirely. Loud about rankings, careless about the data behind them.',
  url: 'https://osr.statisticsauthority.gov.uk/wp-content/uploads/2015/12/letterfromjanetdownstosirandrewdilnot01101_tcm97-44253.pdf',
};

export const RESPONSE_CHECKLIST: { item: string; status: string }[] = [
  { item: 'A permanent monitoring institute (Germany’s IQB)', status: 'England has none — the ILSA function is contracted out per cycle (Pearson/OUCEA now, NFER for TIMSS 2027)' },
  { item: 'Participation discipline (meet response standards; stay in the studies)', status: 'Failed PISA standards in 2003 and 2022; out of TALIS 2024 and ICCS' },
  { item: 'Equity-first response targeting (Startchancen)', status: 'Partially — the missions point this way, unevaluated' },
  { item: 'Pre-registered evaluation of imports before scaling', status: 'Mastery scaled for a decade before its first RCT (2025/26)' },
  { item: 'Statistical hygiene in political communication', status: 'The UKSA reprimand and the unpublished 2022 bias analysis say not yet' },
  { item: 'Protection from political churn (Poland’s lesson)', status: 'No mechanism exists; the Curriculum Review’s sober “respectable and stable” framing is a hopeful precedent' },
];

// ---------------------------------------------------------------------------
// 6 · The next readouts
// ---------------------------------------------------------------------------
export interface Readout {
  study: string;
  when: string;
  what: string;
  englandAngle: string;
  colour: string;
}

export const READOUTS: Readout[] = [
  {
    study: 'PISA 2025', when: 'Results December 2026', colour: '#2f6f97',
    what: 'Science as major domain, ~91 systems, computer-adaptive; a new “Learning in the Digital World” domain (results 2027) and the first foreign-language assessment.',
    englandAngle: 'England’s fieldwork ran Feb–Apr 2025. The thing to watch is not the score but the response rate — after 2022’s standards failure, a clean sample matters more than a +5.',
  },
  {
    study: 'PIRLS 2026', when: 'In field NOW (results ~late 2027)', colour: '#3f7d6e',
    what: 'The reading study, fully digital this cycle, ~60 countries.',
    englandAngle: 'The test of whether 4th-in-the-world survives scrutiny: 2021’s rise was partly others falling amid COVID-disrupted testing. The phonics-era cohort is now fully through.',
  },
  {
    study: 'TIMSS 2027', when: 'Results end-2028', colour: '#b4632e',
    what: 'Maths and science, Years 5 and 9 — where England posted significant science gains and top-tier European maths in 2023.',
    englandAngle: 'National centre moves to NFER. The 2023 science surge (Y5 +19, Y9 +14) awaits replication.',
  },
  {
    study: 'PISA 2029', when: 'Cycle confirmed (4-yearly from now)', colour: '#7a5aa6',
    what: 'Reading major; the innovative domain is Media & AI Literacy — the scoreboard is about to start measuring what the AI agendas are racing to deploy.',
    englandAngle: 'Participation expected but unconfirmed. If the AI-tutoring commitments of the white paper land by 2027, this is the first external measure of their world.',
  },
  {
    study: 'The TALIS hole', when: 'Published Oct 2025 — without England', colour: '#b1455e',
    what: 'The teacher-workforce benchmark: 55 systems, ~280k teachers, first AI-use questions.',
    englandAngle: 'England withdrew citing workload burden — so it has no international readout on the workforce crisis the engine models as its strongest attainment channel. Education at a Glance 2025 fills part of the gap: England primary teachers’ real pay −3.6% (2015–24) against +14.6% across the OECD.',
  },
];

export const READOUT_GAP = {
  research: 'The structural gap, stated plainly: England has no permanent benchmarking institution and no between-cycle instrument tied to international scales. The National Reference Test (annual, stable-sample, NFER-run since 2017) is exactly the right kind of instrument — but it is anchored to GCSE standards, not PISA/TIMSS scales. Linking it would give England a yearly, survey-grade readout between the three-to-four-year international cycles — the benchmarking equivalent of the daily attendance feed.',
  eli5: 'England already runs a careful yearly test on a stable sample of pupils to keep GCSE grading honest. Hooking that test to the international scales would tell us every year — not every three or four — whether we’re really getting better.',
};
