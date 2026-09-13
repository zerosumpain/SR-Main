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
  /**
   * A finished product rather than a study or a toy — the card is marked in ink
   * instead of accent so it reads as a different KIND of thing at a glance, not
   * as a more important one. See `.pc.product` in `+page.svelte`.
   */
  product?: true;
  /**
   * Hidden from the public outright: no visibility key, no public/private
   * toggle and no Share button, because there is no state in which this card
   * should be seen by anyone but the owner. Cards carrying it live in
   * `./owner-cards.server.ts` and are NOT in PROJECT_CARDS — see the note
   * there for why the visibility toggle is the wrong instrument for them.
   */
  ownerOnly?: true;
}

export const PROJECT_CARDS: ProjectCard[] = [
  {
    key: 'policy-analysis',
    // Another application answers this path — cloudflared routes
    // /projects/policy-analysis to SR-Policy-Analysis, never to Main. The card
    // is public and the page behind it is not, so a visitor who clicks it meets
    // the login wall; `tag` says so before they do.
    href: '/projects/policy-analysis',
    label: 'Open Policy Analysis',
    kind: 'Product',
    tag: 'Owner only · Policy',
    title: 'Policy Analysis — Reading a Paper the Way Somebody Who Means to Beat It Would',
    blurb:
      'Give it a policy paper and it spends eighteen stages working out who the paper actually hands power to, and what each of them can do about it — which is a different question from whether the drafting is sound, and it is the one nobody asks. It profiles every body the policy touches and then writes the plays each one can run to serve itself at the policy\'s expense, preferring the ones that stay entirely within the rules, because those are the plays nobody has priced. It remembers the actors between assessments, so the next paper starts with what the last one learned, and it reads each new policy against the ones already done for the holes that only exist because both are in force at once. Shareable without a login, and it prints.',
    chips: '18 stages · exploitation playbook · cross-policy · shareable',
    product: true,
  },
  {
    key: 'local-plan-navigator',
    href: '/projects/local-plan-navigator/',
    label: 'Open the Local Plan Navigator',
    kind: 'Prototype',
    tag: 'GOV.UK style · Planning',
    title: 'Local Plan Navigator — Thirty Months, Three Gateways, One Map',
    blurb:
      'A prototype in the style of a GOV.UK service, for the planning officers now working to England\'s 30-month local plan system. The whole process as a map and a page per stage, the three gateways compared, a question flow that says where a plan is and what comes next, a planner that turns a Gateway 1 date into every statutory milestone, checklists for each gateway, and one search across the 2026 Regulations, the SEA Regulations, the NPPF and the guidance. Ask it a question and, if you like, a small model running in your own browser answers from the cited passages. Built deliberately outside this site\'s design system, to GDS standards, and downloadable in full.',
    chips: 'GOV.UK Frontend · 2026 Regulations · NPPF · in-browser model',
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
];
