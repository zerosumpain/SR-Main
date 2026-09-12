/**
 * The Data Spine — the reference field study.
 *
 * Content as DATA, validated against `field-study-system/content.schema.json`.
 * Each beat names a template from `templates.json`; the template decides the
 * markup, and `src/lib/fieldstudy/` renders it. There is no bespoke page
 * layout under this route, which is the point: this is the study the others
 * are migrated toward, and the one Studio's output is compared against.
 *
 * The authored content is the design system's own reference expression of this
 * study (`field-study-system/example/data-spine.study.json`). To change what
 * the study SAYS, change it here. To change how a beat LOOKS, change the
 * template — and a template change applies to every study, so raise it rather
 * than forking a layout locally.
 *
 * `fieldstudy/validate.ts` re-checks the invariants the types cannot express;
 * `study.test.ts` fails the build if any of them break.
 */
import type { Study } from '$lib/fieldstudy/study';

export const study: Study = {
  slug: 'data-spine',
  number: 5,
  title: 'What is the education data spine?',
  subject: 'The Data Spine',
  statusStamp: 'DFE · ANNOUNCED FEB 2026 · NOT YET BUILT',
  thesis: 'In February 2026 the government committed, in one paragraph of a white paper, to build a “data spine” for English education. This project takes that paragraph seriously — what a spine is, what it would be worth, who wants what from it, and how it could be built without repeating the mistakes already made with children\'s data.',
  private: true,
  updated: '2026-08-11',
  status: {
    headline: 'Announced, unspecified, unbuilt.',
    detail: 'Consultation promised for summer 2026; the white paper\'s own phasing puts implementation at 2028–29.',
    confidence: 'fact',
  },
  findings: [
    {
      text: 'The public specification of the spine fits in three quotations. Everything that matters — custody, architecture, who may look — is undecided.',
      confidence: 'fact',
      cites: [
        1,
        2,
        3,
      ],
    },
    {
      text: 'The <b>long tail of suppliers</b>, not the three majors, is the binding design constraint — and it serves nurseries, special schools and alternative provision.',
      confidence: 'fact',
      cites: [
        11,
      ],
    },
    {
      text: 'A federated spine can answer the department\'s questions without a new central store. The remaining obstacle is legal and political, not technical.',
      confidence: 'hypothesis',
    },
  ],
  asks: [
    'What exactly has been announced — and what remains undecided?',
    'What is a data spine made of, and what are the options at each layer?',
    'How does it differ from the consistent child identifier, and why does confusing them matter?',
    'Could it be built without spending the last of the public\'s trust?',
  ],
  glossary: [
    {
      term: 'MIS',
      plain: 'The system a school keeps its register in.',
    },
    {
      term: 'UPN',
      plain: 'Unique pupil number — the school-side identifier.',
    },
    {
      term: 'Federated query',
      plain: 'Asking every holder a question instead of collecting their records.',
    },
  ],
  sources: [
    {
      n: 1,
      org: 'DfE',
      what: 'Every Child Achieving and Thriving, p.98 — the spine paragraph',
      url: 'https://www.gov.uk/government/publications/every-child-achieving-and-thriving',
      kind: 'white paper',
      asOf: 'Feb 2026',
    },
    {
      n: 2,
      org: 'DfE',
      what: 'Bett 2026 remarks on the spine',
      url: 'https://www.gov.uk/government/publications/every-child-achieving-and-thriving',
      kind: 'press',
      asOf: '2026',
    },
    {
      n: 3,
      org: 'DfE',
      what: 'White paper phasing annex',
      url: 'https://www.gov.uk/government/publications/every-child-achieving-and-thriving',
      kind: 'white paper',
      asOf: 'Feb 2026',
    },
    {
      n: 11,
      org: 'WhichMIS',
      what: 'School management information system market shares',
      url: 'https://www.whichmis.co.uk/',
      kind: 'market data',
      asOf: 'Oct 2025',
      caveat: 'shares drift quarterly',
    },
    {
      n: 14,
      org: 'DfE',
      what: 'The commitment, verbatim, p.98',
      url: 'https://www.gov.uk/government/publications/every-child-achieving-and-thriving',
      kind: 'white paper',
      asOf: 'Feb 2026',
    },
    {
      n: 21,
      org: 'Parliament',
      what: 'ContactPoint shutdown, research briefing SN05171',
      url: 'https://researchbriefings.files.parliament.uk/documents/SN05171/SN05171.pdf',
      kind: 'hansard',
      asOf: '2010',
    },
    {
      n: 33,
      org: 'RIA Estonia',
      what: 'X-Road performance characteristics',
      url: 'https://e-estonia.com/solutions/interoperability-services/x-road/',
      kind: 'technical',
    },
  ],
  instruments: [
    {
      id: 'trace',
      name: 'Trace a request',
      href: '/projects/data-spine/trace',
      kind: '2d-staged',
      reachedFrom: [
        '03',
      ],
      scenarios: [
        {
          id: 'attendance-daily',
          label: 'Daily attendance, one local authority',
          difficulty: 'easy',
        },
      ],
      limits: 'Timings are modelled from published NHS Spine and X-Road latency figures, not measured on any DfE system. The identity-resolution step is the one with no published English standard.',
    },
    {
      id: 'federation',
      name: 'The federation, live',
      href: '/projects/data-spine/federation/sim',
      kind: '3d-network',
      reachedFrom: [
        '03',
        '05',
      ],
      levers: [
        {
          id: 'estates',
          label: 'Estates connected',
          kind: 'B1',
          baseline: 9,
          min: 0,
          max: 15,
        },
        {
          id: 'optOut',
          label: 'Opt-out rate',
          kind: 'B1',
          baseline: 3,
          min: 0,
          max: 25,
          unit: '%',
        },
        {
          id: 'custody',
          label: 'Custody',
          kind: 'B2',
          baseline: 'connect',
        },
        {
          id: 'focus',
          label: 'Focus',
          kind: 'B4',
          baseline: 'all',
        },
      ],
      scenarios: [
        {
          id: 'attendance-cin',
          label: 'Attendance × children\'s social care, by LA',
          difficulty: 'hard',
        },
        {
          id: 'fsm-attainment',
          label: 'FSM × attainment (single context)',
          difficulty: 'easy',
        },
      ],
      limits: 'Timings modelled from published NHS Spine and X-Road figures, not measured on any DfE system. Every cross-sector join shown is probabilistic; unmatched records are shown dropping out.',
    },
  ],
  beats: [
    {
      no: '00',
      slug: '',
      name: 'Front matter',
      template: 'T0',
    },
    {
      no: '01',
      slug: '',
      name: 'The problem',
      template: 'T1',
      minutes: 4,
      question: 'What exactly has been announced, and by whom?',
      claim: {
        text: {
          research:
            '<b>The entire public record of the spine is three quotations.</b> Everything a design would need is still to be decided.',
          plain:
            '<b>Everything the government has said about the data spine fits in three quotations.</b> Everything you would need to actually build one is still undecided.',
        },
        confidence: 'fact',
        cites: [
          1,
          2,
          3,
        ],
      },
      prose: [
        {
          research: 'The full public specification of the data spine fits in three quotations. The white paper names the data in scope and the qualities demanded — and nothing else: no architecture, no custodian, no budget, no delivery date.',
          plain: 'Three quotes are the entire public record. Everything else is still to be decided.',
          dropCap: true,
        },
      ],
      pullQuote: 'One paragraph, on page 98, with no architecture attached.',
      sections: [
        {
          template: 'T7',
          title: 'How England got here',
          threads: [
            {
              name: 'Capability built',
              detail: 'NPD, the attendance feed, the Education Record, now the spine. Each one made the next possible.',
              tag: 'operational',
            },
            {
              name: 'Trust spent',
              detail: 'ContactPoint, the distribution era, the Home Office MoU, the ICO audit. Each one made the next harder.',
              tag: 'trust',
            },
          ],
          entries: [
            {
              date: '2002',
              title: 'The National Pupil Database begins',
              detail: 'Census returns become a permanent longitudinal record. No sunset clause was ever set.',
              tag: 'infrastructure',
            },
            {
              date: '2010',
              title: 'ContactPoint is switched off',
              detail: 'A national index of every child, cancelled on cost and proportionality. The objections were never answered.',
              tag: 'trust',
              cites: [
                21,
              ],
            },
            {
              date: '2016',
              title: 'The Home Office memorandum',
              detail: 'School census data shared for immigration enforcement.',
              tag: 'trust',
            },
            {
              date: '2020',
              title: 'The ICO audit',
              detail: 'The regulator found the department in breach of data-protection law.',
              tag: 'trust',
            },
            {
              date: '2024',
              title: 'Daily attendance goes mandatory',
              detail: 'Automated extraction from every state school\'s MIS — the spine\'s proof of concept, under a commercial contract.',
              tag: 'operational',
            },
            {
              date: '2025',
              title: 'Data (Use and Access) Act',
              detail: 'The legal plumbing a spine would run on, plus the consistent child identifier in statute.',
              tag: 'identifier',
            },
            {
              date: 'Feb 2026',
              title: 'The white paper commits to a spine',
              detail: 'One paragraph on page 98. Consultation promised for the summer.',
              tag: 'infrastructure',
              cites: [
                14,
              ],
              present: true,
            },
          ],
          balance: 'The two accounts do not net off. Capability compounds while trust depletes, and the consultation inherits the balance of both.',
        },
      ],
      soWhat: {
        research:
          'There is less here than the debate assumes. The argument is not about a system that exists — it is about a paragraph.',
        plain:
          'People are arguing as though something has been built. Nothing has. There is a paragraph, and everything else is still an open question.',
      },
      openQuestion: {
        text: {
          research:
            'Has the trust account ever recovered anywhere, after a breach of this kind?',
          plain:
            'Has public trust ever come back anywhere, after this kind of breach?',
        },
        falsifier: 'a documented recovery',
      },
    },
    {
      no: '02',
      slug: 'sources',
      name: 'The estate & the evidence',
      template: 'T2',
      minutes: 6,
      question: 'What exists today, who holds it, and how do we know?',
      claim: {
        text: {
          research:
            '<b>Three suppliers cover four schools in five</b> — but the twelve that cover the rest are the ones serving nurseries, special schools and alternative provision.',
          plain:
            '<b>Three companies serve four schools out of every five</b> — but the twelve companies serving the rest are the ones covering nurseries, special schools and alternative provision.',
        },
        confidence: 'fact',
        cites: [
          11,
        ],
      },
      standfirst: {
        research:
          'Nobody can design a spine without knowing how many estates it has to reach. So: every supplier, with a real number against it, and the date the number was true.',
        plain:
          'You cannot design this without knowing how many different systems it has to reach. So: every supplier, with a real number next to it, and the date that number was true.',
      },
      survey: {
        columns: [
          'Supplier',
          'Kind',
          'Schools',
          'Share',
          'Query interface',
        ],
        rows: [
          {
            cells: [
              'Arbor',
              'cloud MIS',
              9677,
              '43.9%',
              'API, documented',
            ],
            basis: 'census',
          },
          {
            cells: [
              'ESS SIMS',
              'on-premise',
              6897,
              '31.3%',
              'per-site, varies',
            ],
            basis: 'census',
          },
          {
            cells: [
              'Bromcom',
              'cloud MIS',
              3493,
              '15.9%',
              'API, documented',
            ],
            basis: 'census',
          },
          {
            cells: [
              'ScholarPack',
              'cloud, primary',
              800,
              '3.6%',
              'API, documented',
            ],
            basis: 'census',
          },
          {
            cells: [
              'RM Integris',
              'hosted',
              650,
              '3.0%',
              'on request',
            ],
            basis: 'census',
          },
          {
            cells: [
              'The long tail — 10 further suppliers',
              'mixed',
              501,
              '2.3%',
              'none published',
            ],
            basis: 'census',
            pick: true,
          },
          {
            cells: [
              'Independent, early years, bespoke — 6 vendors',
              'not in census',
              undefined,
              undefined,
              'unknown',
            ],
            basis: 'estimate',
          },
        ],
        total: {
          label: 'Reconciles to state census',
          value: 22018,
          reconciles: true,
        },
        provenance: 'WhichMIS, October 2025. Every count reconciles to the 22,018 state census; the estimate band is excluded from that total and from every share.',
        asOf: 'October 2025',
        cannotTellYou: [
          'How many children appear in more than one estate under different identifiers.',
          'Whether the long tail could afford a query interface at all.',
          'Anything about independent schools or early years, which are not in the census.',
        ],
      },
      sections: [
        {
          template: 'T8',
          title: 'It has been tried before',
          claim: {
            text: {
              research:
                '<b>Every spine that died was a central store; every one that survived moved questions.</b> The sample is small, but unanimous.',
              plain:
                'Every one of these systems that was scrapped had put the records in one place. Every one that survived left the records alone and sent the questions instead. It is a small set of examples, but they all point the same way.',
            },
            confidence: 'fact',
          },
          cases: [
            {
              place: 'England',
              year: '2004',
              name: 'NHS Spine',
              what: 'Demographics service plus a record locator. Holds identity and pointers; records stay in trusts.',
              archetype: 'federated',
              fate: 'Live · 20 years',
              fateKind: 'live',
              lesson: 'The name everyone borrows was never a database.',
            },
            {
              place: 'Estonia',
              year: '2001',
              name: 'X-Road',
              what: 'A query fabric across the whole state. No central copy; every request logged and citizen-visible.',
              archetype: 'federated',
              fate: 'Live · 24 years',
              fateKind: 'live',
              lesson: 'Citizens tolerate the plumbing because they can watch it.',
              cites: [
                33,
              ],
            },
            {
              place: 'England',
              year: '2009',
              name: 'ContactPoint',
              what: 'An index of all 11 million children, with 390,000 authorised users.',
              archetype: 'central-store',
              fate: 'Cancelled 2010',
              fateKind: 'cancelled',
              lesson: 'Scale of access, not scale of data, is what ended it.',
              cites: [
                21,
              ],
            },
            {
              place: 'Denmark',
              year: '1968',
              name: 'CPR',
              what: 'A civil registration number used across every public service, with statutory purpose limits.',
              archetype: 'identifier-led',
              fate: 'Live · 57 years',
              fateKind: 'live',
              lesson: 'An identifier is survivable if the limits arrive with it.',
            },
          ],
          pattern: [
            'Survivors hold identity and audit centrally, and nothing else. The three that died all held records.',
            'Survivors made access visible to the citizen from the start. Retrofitting transparency has never once worked.',
            'Every failure was political, not technical. All three cancelled systems worked as specified when switched off.',
          ],
        },
      ],
      soWhat: {
        research:
          'The estate is more concentrated than the debate assumes and more fragmented than a designer would like. Both facts constrain the answer, and they pull in opposite directions.',
        plain:
          'The market is more concentrated than people assume, and more scattered than a designer would like. Both things are true, and they pull in opposite directions.',
      },
      openQuestion: {
        text: {
          research:
            'Nobody publishes how many of the 22,018 could serve a query today. The department must know; it has not said.',
          plain:
            'How many schools could answer a question right now? Nobody publishes that number, and the people who know it are not saying.',
        },
        falsifier: 'a published readiness assessment',
      },
    },
    {
      no: '03',
      slug: 'architecture',
      name: 'Ways to build it',
      template: 'T1',
      minutes: 5,
      question: 'If you had to build it, what are the actual options — and which have already been tried?',
      claim: {
        text: {
          research:
            '<b>There are four archetypes, not a spectrum</b> — three have a real precedent, and only one requires copying children\'s records into a new store.',
          plain:
            '<b>There are four ways to build this, not a sliding scale</b> — three of them are already running somewhere, and only one needs children’s records copied into a new database.',
        },
        confidence: 'fact',
        cites: [
          14,
          21,
        ],
      },
      marginNotes: [
        {
          text: {
            research:
              'The word does five jobs. Collapsing them into “database” is how the argument gets lost.',
            plain:
              'The word “spine” is doing five different jobs at once. Squashing them all into “database” is how this argument goes wrong.',
          },
        },
      ],
      prose: [
        {
          research: 'Every school already keeps its register in a management information system. The question the consultation must answer is <b>custody</b>: connect those estates with a query fabric, or collect them into another central store.',
          plain: 'Schools already hold the data. The question is whether the government asks them, or copies it.',
          dropCap: true,
        },
        {
          research: 'Where a spine has succeeded, the pattern is consistent. The centre holds identity, permission and audit. The records stay where they are generated.',
        },
      ],
      figures: [
        {
          no: '3.1',
          caption: {
            research:
              'The four archetypes and their fates. Three are already running in British government; the accent marks the one this study goes on to defend in beat 04.',
            plain:
              'The four ways of building it, and what happened to each. Three already run in British government; the highlighted one is the design this study goes on to argue for. What it cannot show is cost — none of these programmes published a comparable figure.',
          },
          chart: 'A4',
          unit: 'archetype',
        },
        {
          no: '3.2',
          caption: {
            research:
              'A schools × local-authority join, modelled. The dropped column is the one that matters: those children exist, and the answer silently excludes them.',
            plain:
              'What happens when you try to match school records to council records. The dropped column is the one that matters: those children are real, and the answer quietly leaves them out. This is a model, not a measurement — nobody has published the real match rate.',
          },
          chart: 'A1',
          unit: '% of records',
          cites: [
            33,
          ],
        },
      ],
      pullQuote: 'The department does not need to invent an architecture. It needs to choose one and say so.',
      sections: [
        {
          template: 'T6',
          title: 'Anatomy of a spine',
          claim: {
            text: {
              research:
                '<b>Four of the five layers already exist in some form.</b> The one that does not — governance — is the one every objection is actually about.',
              plain:
                '<b>Four of the five parts already exist in some form.</b> The one that does not — who is allowed to ask, and who checks — is what every objection is actually about.',
            },
            confidence: 'fact',
          },
          layers: [
            {
              no: 'L1',
              name: 'Identifier',
              question: 'who is this child?',
              today: 'UPN in schools, ULN post-16, NHS number in health. None reconcile.',
              withIt: 'One consistent identifier, in statute, with pilots running.',
              theFight: 'Whether it becomes a de facto national ID.',
              tag: 'identifier',
            },
            {
              no: 'L2',
              name: 'Index',
              question: 'who holds a record?',
              today: 'Nothing. Finding a child\'s history means asking around.',
              withIt: 'A record-locator registry: pointers only, no content.',
              theFight: 'A pointer index is itself sensitive — it maps a life.',
            },
            {
              no: 'L3',
              name: 'Exchange',
              question: 'how does it move?',
              today: 'A rented commercial pipe, plus 2,385 bespoke distributions.',
              withIt: 'A query fabric the department governs itself.',
              theFight: 'Connect or collect. This is the whole argument.',
              tag: 'operational',
            },
            {
              no: 'L4',
              name: 'Standards',
              question: 'do we mean the same thing?',
              today: 'Census specifications, revised annually, interpreted locally.',
              withIt: 'A published semantic layer — and a resolution standard.',
              theFight: 'The resolution standard does not exist. Nothing works without it.',
              tag: 'standards',
            },
            {
              no: 'L5',
              name: 'Governance',
              question: 'who may ask, and who checks?',
              today: 'Policy, not statute. An ICO audit found the law was broken.',
              withIt: 'Purpose limits in law, an append-only audit ledger, a public dashboard.',
              theFight: 'Entirely undesigned — and the subject of beat 06.',
              tag: 'trust',
            },
          ],
        },
      ],
      soWhat: {
        research:
          'Three of the four archetypes are already running somewhere in British government. The choice is available; what is missing is a decision, and the standard that makes it work.',
        plain:
          'Somebody in government is already running three of these four designs, so nothing here has to be invented. What is missing is someone choosing one, and writing down the shared rules that make it work.',
      },
      openQuestion: {
        text: {
          research:
            'No lawful shared analytic key exists across schools, local authorities and health. Every join in this study is therefore probabilistic.',
          plain:
            'There is no legal shared reference number linking schools, councils and the NHS. So every match in this study is an educated guess, not a certainty.',
        },
        falsifier: 'a published resolution standard',
      },
    },
    {
      no: '04',
      slug: 'model',
      name: 'The recommendation',
      template: 'T3',
      minutes: 4,
      question: 'Which archetype, and why that one?',
      claim: {
        text: {
          research:
            '<b>Centralise the trust, not the data.</b>',
          plain:
            '<b>Put the permission system in one place. Leave the records where they are.</b>',
        },
        confidence: 'hypothesis',
      },
      position: {
        statement: {
          research:
            'Centralise the trust, not the data.',
          plain:
            'Put the permission system in one place. Leave the records where they are.',
        },
        elaboration: {
          research:
            'Build the identity, permission and audit layers nationally, once, and govern them in public. Leave every pupil record in the estate that generates it. Move questions, not children.',
          plain:
            'Build the who-are-you, who-may-ask and who-looked parts once, nationally, and run them in the open. Leave every pupil record in the school system that created it. Move the questions, not the children.',
        },
        confidence: 'hypothesis',
        because: [
          {
            headline: 'It is the only archetype with a working precedent at national scale.',
            detail: 'X-Road has run for 24 years across a whole government; the NHS Spine for twenty.',
          },
          {
            headline: 'It answers the stated questions without a new copy to defend.',
            detail: 'Every question in the white paper is an aggregate. None needs the records in one place.',
          },
          {
            headline: 'It is the only design where an opt-out still means something.',
            detail: 'A record never copied can still be withheld. A record already in a warehouse cannot.',
          },
        ],
        rejected: [
          {
            name: 'Central store',
            why: 'Cancelled once already, on precisely these objections, and nothing about them has changed except the public\'s patience.',
          },
          {
            name: 'Broker pipe',
            why: 'It works today — that is the strongest argument for it. But the department rents the governance rather than holding it, and cannot show a parent the audit trail of a system it does not run.',
          },
          {
            name: 'Index & locate',
            why: 'Sound, cheap, and insufficient. A pointer registry can tell you who holds a record; it cannot answer how many children in a local authority were absent last week.',
          },
        ],
        conditions: [
          'A published identity-resolution standard',
          'Statutory purpose limits, not policy ones',
          'A transparency dashboard live from the first query',
          'Funding for the long tail\'s query interface',
        ],
        sinkers: {
          research:
            'If the long tail cannot be brought to a query interface at acceptable cost, federation degrades into a broker pipe with extra steps — and the department will have spent the trust for nothing.',
          plain:
            'If the smaller suppliers cannot be brought up to answering questions at a price anyone will pay, this quietly turns back into a pipe that ships data around with extra steps — and the department will have spent the public’s trust for nothing.',
        },
        phases: [
          {
            label: 'Phase 1',
            name: 'The standard',
            detail: 'Publish identity resolution. Nothing works without it.',
          },
          {
            label: 'Phase 2',
            name: 'The audit ledger',
            detail: 'Before any query runs, so the first one is on the record.',
          },
          {
            label: 'Phase 3',
            name: 'Three estates',
            detail: 'The majors, one question, in public. Then measure.',
          },
          {
            label: 'Phase 4',
            name: 'The long tail',
            detail: 'Funded, not mandated. This is where it succeeds or fails.',
          },
        ],
      },
      soWhat: {
        research:
          'This is a recommendation the department could adopt in the consultation without new legislation. The expensive part is not the technology — it is publishing a standard and then living by it.',
        plain:
          'Nothing here needs a new law. The department could say it in the consultation and start. The hard part is not building anything — it is writing the rules down and then sticking to them when that becomes inconvenient.',
      },
      openQuestion: {
        text: {
          research:
            'Is there any lawful route to a shared analytic key across schools, local authorities and health?',
          plain:
            'Is there any legal way to have one shared reference number across schools, councils and the NHS?',
        },
        falsifier: 'a DUAA route nobody has used yet',
      },
    },
    {
      no: '05',
      slug: 'outcomes',
      name: 'What it does & who wins',
      template: 'T4',
      minutes: 4,
      question: 'Who is better off if this is built, and who is worse off?',
      claim: {
        text: {
          research:
            '<b>Nineteen entries, and the ledger is close to even</b> — because almost every benefit depends on the department also doing something it has not committed to.',
          plain:
            '<b>Nineteen entries, and it comes out roughly even</b> — because nearly every benefit depends on the department also doing something it has not promised to do.',
        },
        confidence: 'hypothesis',
      },
      ledger: {
        lenses: [
          'Parent',
          'MAT data lead',
          'LA children\'s services',
          'MIS vendor',
          'Researcher',
          'DfE policy',
          'DfE digital',
          'Other department',
        ],
        activeLens: 'Parent',
        benefits: [
          {
            text: 'A child moving school keeps their record',
            confidence: 'fact',
          },
          {
            text: {
              research:
                'One transparency dashboard, not 2,385 releases',
              plain:
                'One public page showing who got what, instead of 2,385 separate handovers nobody tracks',
            },
            confidence: 'fact',
          },
          {
            text: 'Children missing education found faster',
            confidence: 'hypothesis',
          },
          {
            text: 'Fewer duplicate data collections',
            confidence: 'hypothesis',
          },
        ],
        risks: [
          {
            text: {
              research:
                'Function creep beyond education',
              plain:
                'The data gets used for things that have nothing to do with schools',
            },
            confidence: 'contested',
          },
          {
            text: 'An opt-out that cannot be honoured',
            confidence: 'hypothesis',
          },
          {
            text: {
              research:
                'Small suppliers priced out of compliance',
              plain:
                'The smaller school-software companies cannot afford the rules, and drop out',
            },
            confidence: 'hypothesis',
          },
          {
            text: {
              research:
                'Probabilistic joins presented as certainty',
              plain:
                'Records matched by educated guesswork, then reported as if they were certain',
            },
            confidence: 'contested',
          },
        ],
        balance: {
          research:
            'Read as a parent, the ledger tips negative — not because the benefits are small, but because every one of them is conditional and every risk is structural.',
          plain:
            'Read as a parent, this comes out negative — not because the benefits are small, but because every one of them depends on something that has not been promised, while every risk is built into the design.',
        },
        byActor: [
          {
            actor: 'Parent',
            gains: 4,
            loses: 6,
            net: 'negative',
            quote: 'Show me the audit trail first.',
          },
          {
            actor: 'MAT data lead',
            gains: 7,
            loses: 2,
            net: 'positive',
            quote: 'Stop asking us for the same return twice.',
          },
          {
            actor: 'MIS vendor',
            gains: 3,
            loses: 5,
            net: 'negative',
            quote: 'Who pays for the interface?',
          },
        ],
      },
      soWhat: {
        research:
          'The winners are institutional and the losers are individual, which is the shape of every data programme that has failed politically.',
        plain:
          'The people who gain are organisations; the people who lose are individuals. That is the shape of every data programme that has failed politically.',
      },
      openQuestion: {
        text: {
          research:
            'Nobody has asked parents what they would trade. Every entry on their side of this page is inferred.',
          plain:
            'Nobody has asked parents what they would accept. Everything on their side of this page is my inference, not their answer.',
        },
        falsifier: 'deliberative research with parents',
      },
    },
    {
      no: '06',
      slug: 'governance',
      name: 'Trust & safeguards',
      template: 'T4',
      minutes: 3,
      question: 'What could go wrong, and what would actually stop it?',
      claim: {
        text: {
          research:
            '<b>Every safeguard proposed so far is policy, not law</b> — and policy is what failed the last four times.',
          plain:
            '<b>None of the protections offered so far are legally binding.</b> They are promises a future government can simply drop — which is how the last four attempts came apart.',
        },
        confidence: 'contested',
      },
      ledger: {
        lenses: [
          'Parent',
          'Privacy advocate',
          'ICO',
          'DfE digital',
        ],
        activeLens: 'Privacy advocate',
        benefits: [
          {
            text: {
              research:
                'Query-not-copy is auditable in a way bulk distribution never was',
              plain:
                'Asking a question leaves a record of who asked; handing over a file never did',
            },
            confidence: 'fact',
          },
          {
            text: {
              research:
                'DUAA 2025 provides a lawful basis that does not need new primary legislation',
              plain:
                'The 2025 Act already provides the legal basis, so no new law is needed to start',
            },
            confidence: 'fact',
          },
        ],
        risks: [
          {
            text: {
              research:
                'The 2016 Home Office memorandum has no statutory bar on repetition',
              plain:
                'Nothing in law stops a repeat of the 2016 deal that shared school data with the Home Office',
            },
            confidence: 'contested',
          },
          {
            text: {
              research:
                '2,385 NPD distributions remain outside any single audit trail',
              plain:
                'The 2,385 handovers of the national pupil database that already happened sit outside any single record of who has what',
            },
            confidence: 'fact',
          },
          {
            text: {
              research:
                'Purpose limits held in policy can be changed without Parliament',
              plain:
                'Limits on what the data may be used for are policy, so a minister can change them without asking Parliament',
            },
            confidence: 'contested',
          },
        ],
        balance: {
          research:
            'The architecture can be made trustworthy. The governance, as announced, cannot — because nothing in it is binding on a future minister.',
          plain:
            'The design can be made trustworthy. The rules around it, as announced, cannot — because nothing in them binds a future minister.',
        },
      },
      soWhat: {
        research:
          'Architecture alone cannot answer the objections. The safeguards have to be the kind that survive a change of government.',
        plain:
          'The design on its own cannot answer the objections. The protections have to be the kind that survive a change of government.',
      },
      openQuestion: {
        text: {
          research:
            'Would statutory purpose limits actually pass, given the Home Office\'s interest in the same data?',
          plain:
            'Would a law limiting what the data can be used for actually get through, when the Home Office wants the same data?',
        },
        falsifier: 'a government amendment tabled',
      },
    },
    {
      no: '07',
      slug: 'next',
      name: 'What happens next',
      template: 'T3',
      minutes: 2,
      question: 'What would change the picture, and when?',
      claim: {
        text: {
          research:
            '<b>Three things are due before the end of 2026</b>, and one of them decides everything else.',
          plain:
            '<b>Three things happen this year, and one of them settles the rest.</b> It is the consultation document, and it may settle it by saying nothing.',
        },
        confidence: 'fact',
        cites: [
          3,
        ],
      },
      position: {
        statement: {
          research:
            'Watch the consultation for one word: custody.',
          plain:
            'Watch the consultation for one word: who holds the records.',
        },
        elaboration: {
          research:
            'The consultation document will either name an architecture or defer it. If it defers, the broker pipe becomes the spine by default — not by decision.',
          plain:
            'The consultation will either say who holds the records or duck the question. If it ducks it, the existing pipe becomes the spine by default — nobody will have decided that, it will just happen.',
        },
        confidence: 'hypothesis',
        because: [
          {
            headline: 'Summer 2026: the consultation opens.',
            detail: 'The first document that could contain an architecture.',
          },
          {
            headline: '2028–29: the white paper\'s own implementation window.',
            detail: 'Which means procurement decisions in 2027.',
          },
          {
            headline: 'Meanwhile the attendance feed keeps running.',
            detail: 'Every month it runs, the default hardens.',
          },
        ],
        rejected: [
          {
            name: 'Waiting for the consultation to ask better questions',
            why: 'Consultations answer the questions they are given. The architecture question has to be raised before the document is drafted, not after.',
          },
        ],
        conditions: [
          'A published resolution standard',
          'A named custodian',
        ],
        sinkers: {
          research:
            'Deferral. A consultation that does not name a custody model has already chosen the incumbent.',
          plain:
            'Ducking it. A consultation that does not say who holds the records has already picked whoever holds them now.',
        },
        phases: [
          {
            label: 'Open',
            name: 'The resolution standard',
            detail: 'Still unwritten. The single largest gap in this study.',
          },
          {
            label: 'Open',
            name: 'The custodian',
            detail: 'No named owner for any layer.',
          },
          {
            label: 'Open',
            name: 'The long tail\'s cost',
            detail: 'Unpriced, and decisive.',
          },
        ],
      },
      soWhat: {
        research:
          'The decision that matters will be made by whether the consultation document uses the word custody — and it may be made by not using it.',
        plain:
          'The decision that matters comes down to whether the consultation document uses the word custody — and it may get made by leaving it out.',
      },
      openQuestion: {
        text: {
          research:
            'Is the consultation drafted already? If so, none of this analysis reaches it in time.',
          plain:
            'Has the consultation already been written? If it has, none of this reaches it in time.',
        },
        falsifier: 'a published drafting timetable',
      },
    },
  ],
};
