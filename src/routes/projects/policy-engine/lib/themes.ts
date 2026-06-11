// themes.ts — the SECOND spine. The existing spine threads every study to a data-strategy
// question ("what would tell us this worked?"). This one threads the SUBSTANTIVE findings:
// four themes that recur across Early Years, SEND, Jigsaw, Monitoring, Attendance and NEET.
// Each theme gathers the studies it runs through, the levers that move it, the outcomes it
// shows up in, and the third-party analyses + contradictions that bear on it — so "learning
// across the pages, by theme" has a home. Self-contained.

export interface ThemeStudyLink { route: string; label: string; note: string; }

export interface Theme {
  id: string;
  no: number;
  title: string;
  tagline: string;
  summary: string;        // research register
  summaryEli5: string;    // plain English
  recurs: ThemeStudyLink[];
  levers: string[];
  outcomes: string[];
  analyses: string[];     // ids in evidence.ts
  contradictions: string[]; // ids in contradictions.ts
  dataAsk: string;
  color: string;
}

export const THEMES: Theme[] = [
  {
    id: 'early-identification',
    no: 1,
    title: 'Early identification',
    tagline: 'The same pattern in five studies: see it sooner, spend less, harm less.',
    summary: 'Across SEND, NEET, attendance, early years and safeguarding, the recurring finding is that the signal precedes the crisis: the predictors are visible in existing data years before the outcome they forecast. Whether the system acts on that signal early — the 2½-year review, the attendance trajectory, the RONI risk index, the EHC needs assessment — is the variable that separates prevention from late, costly remediation.',
    summaryEli5: 'In study after study, the warning signs show up years before the problem does — in data we already collect. Acting early is cheaper and kinder; acting late is the expensive default.',
    recurs: [
      { route: '/projects/policy-engine/early-years', label: 'Early Years', note: 'the 2½-year review is the last universal sighting before school' },
      { route: '/projects/policy-engine/send', label: 'SEND', note: 'early identification is cheapest per child and prevents escalation' },
      { route: '/projects/policy-engine/attendance', label: 'Attendance', note: 'absence is a leading indicator visible daily' },
      { route: '/projects/policy-engine/neet', label: 'NEET', note: 'absence, EHCP and attainment predict NEET years ahead' },
      { route: '/projects/policy-engine/jigsaw', label: 'Jigsaw', note: 'the join that catches a child before harm' },
    ],
    levers: ['send_early', 'aid_ey', 'attendance', 'ey_quality', 'careers_gatsby'],
    outcomes: ['gapAge3', 'gapReception', 'persistentAbsenceDis', 'neet', 'ehcpAttainment8'],
    analyses: ['epi-early-gap', 'epi-annual-2025', 'isos-send', 'resolution-neet', 'ippr-send'],
    contradictions: ['send-cost-driver', 'attendance-enforcement'],
    dataAsk: 'A consistent child identifier and in-year (not annual) signals, so the data that already exists can be used while there is still time to act.',
    color: '#3f7d6e',
  },
  {
    id: 'data-gap',
    no: 2,
    title: 'The health↔education data gap',
    tagline: 'The pre-school signal lives in health systems and never reaches education.',
    summary: 'The single sharpest cross-cutting finding: the richest early signal about a child — developmental checks, the 2½-year integrated review, CAMHS contact, the autism/ADHD/SLT queues — is held by health and social care and does not flow into the education data estate. The same break recurs in SEND (health queues sit outside DfE), in early years (the integrated review is lost to education), and in safeguarding (the picture fragments across holders). It is one structural gap appearing in four places.',
    summaryEli5: 'A child’s earliest and most important information sits with doctors and health visitors — and it never reaches the people running schools. The same disconnect shows up in special-needs, early years and child-protection.',
    recurs: [
      { route: '/projects/policy-engine/monitor', label: 'Monitoring', note: 'the data estate fragments across census, health and social care' },
      { route: '/projects/policy-engine/jigsaw', label: 'Jigsaw', note: 'the picture of a child is distributed by design; the joins fail' },
      { route: '/projects/policy-engine/send', label: 'SEND', note: 'autism/ADHD/SLT queues sit outside the education view' },
      { route: '/projects/policy-engine/early-years', label: 'Early Years', note: 'the 2½-year review is held by health, not education' },
    ],
    levers: ['send_pipeline', 'camhs', 'aid_ey'],
    outcomes: ['ehcpPct', 'gapReception', 'gapAge3'],
    analyses: ['adruk-echild', 'ifg-data', 'adalovelace-data', 'nao-send-2024'],
    contradictions: ['send-cost-driver'],
    dataAsk: 'A linked record across health and education (ECHILD demonstrates it is possible) and a single accountable owner for the join — the part that is currently nobody’s job.',
    color: '#2f6f97',
  },
  {
    id: 'equity-not-money',
    no: 3,
    title: 'Equity, not just money',
    tagline: 'How resources are distributed and used outweighs how much there is.',
    summary: 'The engine’s core thesis, corroborated from several angles: internationally, spend above a threshold explains little of the variation in outcomes while equity (the socio-economic gradient) differentiates leaders; SEND spending rose ~58% in real terms without moving outcomes; the childcare expansion adds spend but is structured to reach few disadvantaged children. The model encodes this by routing money through teacher capacity rather than a direct £→attainment elasticity — a deliberate, and contested, modelling choice.',
    summaryEli5: 'Spending more doesn’t automatically help; spending it on the right children, in the right way, does. Countries that do better aren’t the ones that spend most — they’re the ones whose poorer pupils fall less far behind.',
    recurs: [
      { route: '/projects/policy-engine/global', label: 'Global', note: 'money doesn’t separate systems; equity does' },
      { route: '/projects/policy-engine/send', label: 'SEND', note: '+58% real spend, flat outcomes' },
      { route: '/projects/policy-engine/early-years', label: 'Early Years', note: 'the 30-hours offer adds spend but is broadly gap-neutral' },
      { route: '/projects/policy-engine/regions', label: 'Regions', note: 'a place residual two equally-poor areas don’t share' },
    ],
    levers: ['school_funding', 'pupil_premium', 'teachers', 'ey_access', 'ey_quality'],
    outcomes: ['attainment8', 'gapKS4', 'gld', 'gapReception'],
    analyses: ['oecd-pisa', 'nao-send-2024', 'suttontrust-ey', 'cep-teachers', 'ifs-spend-2025', 'gorard-pp', 'localtrust-lbn'],
    contradictions: ['funding-attainment', 'pupil-premium', 'thirty-hours-gap'],
    dataAsk: 'Spend-per-stage accounting (not headline budgets) and outcome tracking by deprivation decile, so the distribution — not just the total — is visible.',
    color: '#b4632e',
  },
  {
    id: 'measurement-validity',
    no: 4,
    title: 'Measurement validity',
    tagline: 'What we measure, when, and whether the number means what it says.',
    summary: 'The meta-theme that justifies the project: threshold measures hide progress below the bar; annual and lagged data mean feedback runs in years, not terms; the only signals that reliably reach the centre are adversarial ones (tribunals, inspection); and many headline associations are confounded (absence→attainment, mental-health→attainment). The discipline the engine tries to keep — associational not causal, an assumption to test not a fact — is itself the response to this theme.',
    summaryEli5: 'A lot of the “facts” about schools are shakier than they look: pass/fail lines hide real progress, the data arrives years late, and some numbers measure the system’s stress rather than its success.',
    recurs: [
      { route: '/projects/policy-engine/monitor', label: 'Monitoring', note: 'the feedback loop runs in years, not terms' },
      { route: '/projects/policy-engine/attendance', label: 'Attendance', note: 'a brilliant instrument, not yet proven to help' },
      { route: '/projects/policy-engine/global', label: 'Global', note: 'small PISA rank differences are not reliable' },
      { route: '/projects/policy-engine/send', label: 'SEND', note: 'the tribunal is the only feedback loop that works' },
    ],
    levers: ['attendance', 'curriculum'],
    outcomes: ['attainment8', 'persistentAbsence', 'tribunalAppeals'],
    analyses: ['gorard-pp', 'fft-absence', 'dfe-attendance', 'policyexchange-standards', 'smf-skills', 'adalovelace-data'],
    contradictions: ['pisa-reliability', 'attendance-enforcement', 'pupil-premium', 'london-effect'],
    dataAsk: 'Published precision/recall on any deployed model, in-year feedback, and progress (not threshold) measures — so the number can be trusted before it is acted on.',
    color: '#7a5aa6',
  },
];

export const THEMES_BY_ID: Record<string, Theme> = Object.fromEntries(THEMES.map((t) => [t.id, t]));

/** Themes that run through a given study route (for the masthead rail). */
export function themesForRoute(route: string): Theme[] {
  const r = route.replace(/\/$/, '');
  return THEMES.filter((t) => t.recurs.some((s) => s.route.replace(/\/$/, '') === r));
}
