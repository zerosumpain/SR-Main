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
    key: 'hex',
    href: '/projects/hex/',
    label: 'Open Hex',
    kind: 'Game',
    tag: 'Playable · Owner sign-in',
    title: 'Hex',
    blurb:
      'Build a world, choose your rivals, and play for the frontier. An isometric hex conquest game with configurable maps and players, a reinforcement-learning lab, and a rule forge that turns your ideas into new game mechanics. Play a turn yourself, watch the AI compete, or let it learn through thousands of headless matches.',
    chips: 'turn-based conquest · PyTorch · custom rules · independent app',
  },

  {
    key: 'field-study-8',
    href: '/projects/field-study-8/',
    label: 'Open Field Study №8',
    kind: 'Field Study №8',
    tag: 'Private · Working model',
    title: 'Private working model',
    blurb: 'Procurement analysis built from public records. Owner only.',
    chips: 'public records · private',
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
    tag: 'Interactive · Three features, explained',
    title: 'The Engine Room — Daydream, Build and the App',
    blurb:
      'Three parts of this site that aren’t ordinary. Daydream thinks about my life on spare cycles, one narrow question at a time, and writes down what’s worth my attention. Build turns the ideas I accept into real changes to the site, with a brief, a running preview and tests, and only ever reaches production through a pull request. And the iPhone app carries it all into my pocket, onto the Lock Screen, the watch and Siri. Every stage, limit and count on the pages is read from the running code, so the study changes when the features do.',
    chips: 'daydream · autonomous builds · codegraph · iPhone · live from the code',
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
