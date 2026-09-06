// The hand-built cards on /projects, as data.
//
// They used to be fifteen copies of the same 37-line block of markup, each
// carrying its own font sizes and colours inline. That is how a page drifts out
// of the design system: restyling it meant editing the same card fifteen times
// and missing one, and the copy — the only part that actually differs — was
// buried in the middle of it.
//
// The shape is deliberately the one `resolveProjectCard` already returns for an
// AI-built project, so both kinds of card render through ONE snippet and cannot
// diverge again. Order is editorial, and is the order they appear in.
//
// Visibility is NOT here. Whether a card is shown is the server's answer
// (`data.visibility`), keyed by `key` — and every key must also appear in
// STATIC_PROJECT_KEYS or its toggle silently 400s. `registry-cards.test.ts`
// guards that parity against this array.

export interface ProjectCard {
  /** Visibility key. Must match the key the server reports for this project. */
  key: string;
  href: string;
  /** Accessible name for the card's full-bleed link. */
  label: string;
  /** The accent eyebrow — `Field Study №6`, `Tool`, `Reference`. */
  kind: string;
  /** The muted counterpart on the line below the eyebrow. */
  tag: string;
  title: string;
  blurb: string;
  /** The mono strip along the foot of the card. */
  chips: string;
}

export const PROJECT_CARDS: ProjectCard[] = [
  {
    key: 'bathroom',
    href: '/projects/bathroom',
    label: 'Open Bathroom Planner',
    kind: 'Tool',
    tag: 'Interactive · Home project',
    title: 'Bathroom Planner — Refitting a Terrace Bathroom',
    blurb:
      'Put your own measurements in and drag a bath, a walk-in shower and a wall-hung WC around a to-scale floor plan that knows how much room you need to stand in front of each one, and how far the toilet has drifted from the soil stack. Then a two-way cost model at 2026 rates — set a budget and it picks the spec, or pick the spec and watch it climb — plus who does what, the day-by-day programme, and a 47-item snag list to hold the last 5% against.',
    chips: 'to-scale planner · cost model · snag list',
  },
  {
    key: 'scs-earnings',
    href: '/projects/scs-earnings/',
    label: 'Open Senior Civil Servant Earnings',
    kind: 'Field Study №6',
    tag: 'Interactive · Pay data',
    title: 'Senior Civil Servant Earnings — Fifteen Years of Whitehall Pay',
    blurb:
      'How many mandarins out-earn the Prime Minister? What is a digital director worth against a policy one? Plot the pay of the 46,595 most senior posts across 25 government departments, 2010–2026 — by department, profession, grade and the DDaT-vs-policy split, in real terms or nominal. Built entirely on gov.uk organogram transparency data, with a full glass-box method.',
    chips: 'gov.uk data · 46,595 posts · OGL',
  },
  {
    key: 'broads-pilot',
    href: '/projects/broads-pilot',
    label: 'Open Broads Pilot',
    kind: 'Field Study №5',
    tag: 'Interactive · Route planner',
    title: 'Broads Pilot — Norfolk Broads Route Planner',
    blurb:
      'Pick your hire boat, drop a pin, and see exactly where you can get to today — and safely. True river-following routing over an OpenStreetMap waterway graph, honouring the 3–6 mph speed zones, with travel times, fuel cost and range. Every bridge, the Mutford lock and the Breydon tidal crossing are checked against your boat\'s air draft and beam, with moorings, charges, dog-friendly walks and waterside pubs along the way.',
    chips: 'waterway routing · boat-aware · PWA',
  },
  {
    key: 'terminal-descent',
    href: '/projects/terminal-descent/',
    label: 'Play Terminal Descent',
    kind: 'Field Study №5',
    tag: 'Playable · WebGL',
    title: 'Terminal Descent — A Newtonian Landing Problem',
    blurb:
      'A 3D landing game with real Newtonian physics. Gravity pulls; your single engine only pushes the way the ship points — so to move, you tilt, burn, then tilt back and burn again to kill the drift before you touch down. Manage fuel, thread a procedurally generated hazard field, and set down gently, upright and dead-centre on the pad. Scored on touchdown, fuel saved and centering, with a global leaderboard. Built autonomously from one prompt.',
    chips: 'Three.js · inertia · leaderboard',
  },
  {
    key: 'data-standard-designer',
    href: '/projects/data-standard-designer',
    label: 'Open the Data Standard Designer',
    kind: 'Tool',
    tag: 'Interactive · Standards',
    title: 'Data Standard Designer — Design & Publish a Dataset Standard',
    blurb:
      'A workbench for technical teams to design and publish a dataset standard, grounded in the data standards government already runs — DfE, NHS, ONS, local-gov and W3C. Capture what the data is for, get a schema proposed from established standards, see the live impact on interoperability, assurance and adoption, then export a publication-grade standard with the evidence pack behind it. Two modes: business analyst and data architect.',
    chips: 'interoperability · assurance · JSON Schema · DCAT-AP',
  },
  {
    key: 'engine-room',
    href: '/projects/engine-room',
    label: 'Open The Engine Room',
    kind: 'Field study',
    tag: 'Interactive · This site, explained',
    title: 'The Engine Room — how this site works',
    blurb:
      'This site looks like a blog. Underneath it is a personal knowledge engine — an assistant with reach into mail, files and home, a workflow engine with 88 node types, retrieval over documents, a knowledge graph that resolves entities overnight, and a system that rewrites itself while nobody is watching. Four parts, twenty-one pages, and twenty instruments you can operate rather than read: follow one message through six stages and six layers with a live clock and a running bill, pick a model seller and watch what it costs you, try to get machine-written code past the safety scan, or push a change down the deploy pipeline and watch it stop. Mechanisms and mistakes, no secrets.',
    chips: 'models · caching · RAG · entity resolution · self-improvement · measured',
  },
  {
    key: 'data-spine',
    href: '/projects/data-spine',
    label: 'Open The Data Spine',
    kind: 'Field study',
    tag: 'Interactive · Data infrastructure',
    title: 'The Data Spine — Anatomy of a Promise',
    blurb:
      'In one paragraph of a 2026 white paper, the government committed to build a "data spine" for English education. This study takes the paragraph seriously: a five-layer anatomy, the international precedents (NHS Spine, X-Road, ContactPoint), eight stakeholder lenses on its value, a deep information-governance treatment — and a live 3D simulation of the federated design: 24,000 schools, 15 MIS suppliers, thirteen runnable scenarios from census day to breach day. Companion to Keystone and the Policy Engine.',
    chips: 'precedents · personas · privacy · 3D federation sim · cited',
  },
  {
    key: 'spine-in-practice',
    href: '/projects/spine-in-practice',
    label: 'Open The Spine in Practice',
    kind: 'Field study',
    tag: 'Appraisal · Data infrastructure',
    title: 'The Spine in Practice',
    blurb:
      'While the department\'s data spine was still one paragraph of a white paper, somebody else built one. Open Education AI\'s federated node access layer went live in July 2026, with a deck and a self-contained clickthrough demo to prove it. This study reads both artefacts against my own — the technical structure, how the argument is drawn, what it buys, and what it cannot yet do.',
    chips: 'node contract · consent gate · SDC · built vs designed · cited',
  },
  {
    key: 'dfe-data-strategy',
    href: '/projects/dfe-data-strategy',
    label: 'Open Keystone',
    kind: 'Tool',
    tag: 'Interactive · Data strategy',
    title: 'Keystone — An Education Strategy Workbench',
    blurb:
      'Understand the pressures on an education department\'s use of data — from across government, from its own policy agenda, and from a vast partner system — and shape a strategy that can deliver against them. A research-grounded landscape of pressures, frameworks and the data-sharing legal stack, plus a private workbench: set your posture and investment levers, and a transparent engine scores coverage, maturity and the tensions you create. Upload your own strategy docs to synthesise them in. Companion to the Policy Engine.',
    chips: 'pressures · trade-offs · maturity · cited',
  },
  {
    key: 'dfe-data-estate',
    href: '/projects/dfe-data-estate',
    label: 'Open The Data Estate',
    kind: 'Reference',
    tag: 'Live · DfE APIs',
    title: 'The Data Estate — DfE\'s Public Data Services',
    blurb:
      'A fact-checked map of every public-facing service the Department for Education uses to share and aggregate data — GIAS, Explore Education Statistics, performance tables, Teaching Vacancies, the teacher-training APIs and the restricted pupil-data tier. Where each one\'s data comes from, how often it refreshes, who owns it, and what\'s open — with six widgets calling the real DfE APIs live.',
    chips: 'live APIs · 16 services · OGL',
  },
  {
    key: 'policy-engine',
    href: '/projects/policy-engine',
    label: 'Open Education Policy Modelling',
    kind: 'Field Study №4',
    tag: 'Interactive · Policy sim',
    title: 'Education Policy Modelling — England Schools Simulator',
    blurb:
      'A research-backed, system-dynamics simulation of England\'s schools, 2025–2040. Pull the policy levers — SEND & EHCP reform, pupil premium, attendance, early years, the 6,500-teacher pledge, curriculum reform — and watch the disadvantage gap, attainment, the SEND funding deficit and NEET respond in real calculations. Every effect size is sourced or flagged as an assumption, with Monte-Carlo uncertainty and sensitivity analysis.',
    chips: 'system dynamics · Monte-Carlo · cited',
  },
  {
    key: 'whitehall',
    href: '/projects/whitehall/',
    label: 'Play Whitehall',
    kind: 'Field Study №3',
    tag: 'Playable · WebGL',
    title: 'Whitehall — The Machinery of Government',
    blurb:
      'A turn-based 4X set inside the UK civil service. Cities are government departments, units are civil-service grades — Executive Officers, glass-cannon Fast Streamers, Permanent Secretaries — and level-10 departments commission national Special Projects for empire-wide bonuses. Play solo against an AI that learns from every defeat, or watch eight Whitehall blocs fight it out.',
    chips: 'Three.js · civil service · special projects',
  },
  {
    key: 'archetype',
    href: '/projects/archetype/',
    label: 'Open Archetype',
    kind: 'Field Study №7',
    tag: 'Playable · WebGL',
    title: 'Archetype — an arms race you can watch',
    blurb:
      'An isometric 4X board game whose real subject is the AI. Six named strategists — the Spear, the Jackal, the Sprawl, the Ledger, the Concord, the Bulwark — build models of each other from what they can see through the fog, bend their strategy to exploit what they infer, and provoke each other into counter-adapting. A strategy observatory shows every drive vector, belief and change of mind as it happens.',
    chips: 'Three.js · opponent modelling · co-evolution',
  },
  {
    key: 'brass-and-rails',
    href: '/projects/brass-and-rails/',
    label: 'Play Brass & Rails',
    kind: 'Field Study №2',
    tag: 'Playable · WebGL',
    title: 'Brass & Rails — An Empire of the Skerne',
    blurb:
      'A turn-based 4X empire on a tilt-shift diorama of old Darlington, birthplace of the railway. Settle villages, harvest coal & iron, research the Age of Steam — against an AI that remembers every defeat and rewrites its strategy to beat you next time. Play solo, or watch up to 8 AI houses fight it out autonomously.',
    chips: 'Three.js · tilt-shift · learning AI',
  },
  {
    key: 'data-convergence',
    href: '/projects/data-convergence',
    label: 'Open The Spine',
    kind: 'Field Study №1',
    tag: 'One-shot prompt',
    title: 'The Spine — Data Convergence Timeline',
    blurb:
      'Scattered data sources are tributaries. They enter as oscillating strands of twine, wind together at confluences, and bind into a single horizontal spine — the source of truth. Interactive: play, scrub, edit the sources.',
    chips: 'Canvas · DAG · braid render',
  },
];
