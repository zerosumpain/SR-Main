/**
 * The Spine in Practice — a reading of two artefacts against field study № 5.
 *
 * Content as DATA, validated against `field-study-system/content.schema.json`,
 * exactly as the reference study at /projects/data-spine is. Each beat names a
 * template; the template decides the markup. There is no bespoke layout under
 * this route, and a beat that wants one wants a template change instead.
 *
 * Two authoring rules that bite everywhere in this file:
 *
 *  - `{@html}` is applied to `findings[].text` and `beats[].claim.text` ONLY.
 *    `<b>` belongs there and nowhere else. Every section claim, ledger row,
 *    prose block, so-what, balance, standfirst, caption, fight and sinker
 *    below is plain text and must stay plain text.
 *  - Every source must be cited by something, and every citation must resolve.
 *    `validate.ts` fails the build on either, in both directions.
 *
 * On the subject itself: this study reads two documents from the outside. It
 * ran nothing and measured nothing. Where a status appears here it is a
 * statement its authors made about their own system, carrying the date they
 * gave it — which is why the boundary in this study is theirs, not mine.
 */
import type { Study } from '$lib/fieldstudy/study';

export const study: Study = {
  slug: 'spine-in-practice',
  number: 6,
  title: 'What does a data spine look like when someone builds one?',
  subject: 'The Spine in Practice',
  statusStamp: 'OEAI · DECK 22 JUL 2026 · DEMO 7–10 AUG 2026 · READ FROM THE OUTSIDE',
  thesis:
    'In February 2026 the government committed to a data spine in one paragraph of a white paper. In July 2026 somebody else turned up with part of one running. This study reads two artefacts from Open Education AI and Edequity AI — an eighteen-slide deck dated 22 July 2026, and a self-contained clickthrough of their node access layer whose evidence is dated 7–8 August and whose screen captures are dated 10 August — against the field study next door, across four lenses: technical structure, visual representation, benefits, limitations. It is a personal research project, written from the outside, from documents alone: nothing here was run, measured or verified against a system. And it starts by crediting the thing the deck does better than most documents of its kind — it draws its own boundary, in its own words, and says “Nothing designed is described as built.”',
  private: true,
  updated: '2026-08-28',
  status: {
    headline: 'Read, not audited.',
    detail:
      'Two artefacts and four screenshots, read against a study written before either arrived. Every status quoted here is a statement its authors made about their own system, carrying the date they gave it.',
    confidence: 'fact',
  },

  findings: [
    {
      text: '<b>The boundary is volunteered, not extracted.</b> The deck names four things as not yet built and closes with “Nothing designed is described as built”; the demo files six capabilities under “Not built / not claimed” and blocks the paths it cannot support with a real disabled attribute.',
      confidence: 'fact',
      cites: [1, 2],
    },
    {
      text: '<b>The federation runs on one live node, and OEAI says so themselves.</b> Portability is evidenced once — the same node software, configuration-only, in a customer-controlled cloud tenancy in July 2026 — which is the software moved, not two nodes answering one ask.',
      confidence: 'fact',
      cites: [1, 2],
    },
    {
      text: '<b>Read against this study’s own five layers, the exchange layer is answered in running software and much of governance with it — and the identifier layer is not answered at all.</b> UPN, ULN, NHS number, resolution and linkage appear nowhere in either document. The only identity bound anywhere is the consumer’s.',
      confidence: 'hypothesis',
      cites: [1, 2, 5],
    },
  ],

  asks: [
    'What did they actually build, and what is still a design?',
    'Layer by layer, how does the thing they built compare with the thing I recommended?',
    'Where do the two arguments genuinely disagree, and where do they only look like they disagree?',
    'Having read both, what would I do next?',
  ],

  glossary: [
    {
      term: 'Node',
      plain:
        'A school group’s own analytics environment, once it keeps four promises. The deck’s line is that a node is a contract, not a product.',
    },
    {
      term: 'Controller',
      plain:
        'The organisation that decides — a school, a trust, a local authority. In this design nothing leaves until a controller says yes, per purpose.',
    },
    {
      term: 'Grant',
      plain:
        'One authorisation, recorded as six parts: consumer, declared purpose, scope, privacy tier, expiry, data-sharing-agreement reference.',
    },
    {
      term: 'Tier',
      plain:
        'How protected the thing leaving is. The demo’s ladder runs aggregate-only, pseudonymised + SDC, pseudonymised, pseudonymised + DP (not built), identifiable.',
    },
    {
      term: 'SDC',
      plain:
        'Statistical disclosure control. In the current build: suppress counts under 10, round count cells to 5, refuse unit-level output at aggregate tiers.',
    },
    {
      term: 'Publication floor',
      plain:
        'The one format anything is allowed to leave in — Parquet plus a signed manifest, checked aggregates only.',
    },
    {
      term: 'Code-to-data',
      plain:
        'Send the analysis to the records instead of the records to the analyst. Both documents place the runner that would do this outside what is built.',
    },
    {
      term: 'MCP',
      plain:
        'The machine interface an AI agent calls. A grant scopes which tools the agent may list and call — not arbitrary SQL.',
    },
  ],

  sources: [
    {
      n: 1,
      org: 'Open Education AI / Edequity AI',
      what: 'The National Education Data Spine — 18-slide deck, Dr Matthew Woodruff and Lauren Thorpe',
      url: 'https://openeducationai.org',
      kind: 'technical',
      asOf: '22 Jul 2026',
      caveat:
        'The deck itself is not published at that address; the URL is the organisation’s, taken from the deck’s own slide footer. It names no identity standard, no identity-resolution or linkage method, no auditor of OEAI itself, and no representativeness or coverage analysis. It is a funding-and-partnership pitch, not a specification.',
    },
    {
      n: 2,
      org: 'Open Education AI',
      what: 'Dataspine DfE guided demo — presenter and attendee clickthrough builds, README, and the “What is real, what is simulated” panel',
      url: 'https://openeducationai.org',
      kind: 'technical',
      asOf: '7–10 Aug 2026',
      caveat:
        'A self-contained HTML file, not published at that address. Its own README states that the named organisations, capability counts, controller decisions and research values are fictional; the four embedded product captures are the real staging UI code with seeded, no-pupil-data records, made 10 Aug 2026. It settles nothing about production behaviour.',
    },
    {
      n: 3,
      org: 'DfE',
      what: 'Every Child Achieving and Thriving, p.98 — the spine paragraph, and the phasing annex',
      url: 'https://www.gov.uk/government/publications/every-child-achieving-and-thriving',
      kind: 'white paper',
      asOf: 'Feb 2026',
      caveat:
        'Names the data in scope and the qualities demanded, and nothing else — no architecture, no custodian, no budget, no delivery date. It does not mention OEAI, and OEAI is not a party to it.',
    },
    {
      n: 4,
      org: 'DfE',
      what: 'Using a risk of NEET indicator (RONI) approach — a practical guide for education providers',
      url: 'https://www.gov.uk/government/publications/identifying-and-supporting-young-people-at-risk-of-neet/using-a-risk-of-neet-indicator-roni-approach-a-practical-guide-for-education-providers',
      kind: 'technical',
      asOf: 'updated 2 Jul 2026',
      caveat:
        'The demo’s own cited source for its worked example. It describes indicator families — attendance, behaviour, academic progress, wider vulnerability — and settles nothing about whether school-held signals associate with an observed NEET outcome, which is precisely the gap the demo’s closing card names.',
    },
    {
      n: 5,
      org: 'John Kelly',
      what: 'The Data Spine — Anatomy of a Promise (field study № 5)',
      url: 'https://strangeramblings.com/projects/data-spine',
      kind: 'research',
      asOf: 'updated 11 Aug 2026',
      caveat:
        'Written against the white paper, not against OEAI, which it never mentions and which post-dates most of it. Its timings are the author’s estimates, not measurements — every trace scenario is marked hypothesis — and the page is private, so it returns 404 to an unauthenticated request.',
    },
    {
      n: 6,
      org: 'WhichMIS',
      what: 'School management information system market shares',
      url: 'https://www.whichmis.co.uk/',
      kind: 'market data',
      asOf: 'Oct 2025',
      caveat:
        'Counts reconcile to the 22,018 state census; independent schools and early years are not in it. It surveys MIS suppliers, not analytics platforms — which is the layer an OEAI node sits on — so it cannot say how much of the sector is already on one.',
    },
    {
      n: 7,
      org: 'OpenSAFELY Schools',
      what: 'The programme — NIoT × Bennett Institute; around 170 schools, 6,500 teachers, 115,000 pupils',
      url: 'https://schools.opensafely.org/',
      kind: 'research',
      asOf: 'read Aug 2026',
      caveat:
        'Cited here as the comparator neither OEAI artefact names. Field study № 5 records it as running in a segregated Microsoft Azure tenancy, ingesting through a purpose-built extraction API, currently on a more direct SQL runner rather than the full production query layer, and as a proof of concept rather than a national service. It is not a live federated code-to-data runner.',
    },
  ],

  beats: [
    // ——————————————————————————————————————————————————————————————
    {
      no: '00',
      slug: '',
      name: 'Front matter',
      template: 'T0',
    },

    // ——————————————————————————————————————————————————————————————
    // Beat 01 has no slug of its own: the landing page IS the problem
    // statement, so a reader who arrives has already started.
    {
      no: '01',
      slug: '',
      name: 'The two documents',
      template: 'T1',
      minutes: 5,
      question: 'What arrived, and why is it now in the same conversation as a paragraph on page 98?',
      claim: {
        text: '<b>The announced spine and the built federation are two different objects.</b> One is a paragraph with no architecture attached. The other is a node access layer in production, on one live node.',
        confidence: 'fact',
        cites: [1, 2, 3],
      },
      standfirst:
        'Two documents landed three weeks apart. A deck that says what has been built and, unusually, what has not; and a clickthrough that walks a fictional research organisation from an invitation to a checked answer. Neither is the thing the white paper announced. That is the interesting part.',
      marginNotes: [
        {
          label: 'Capacity',
          text: 'I have no relationship with Open Education AI or Edequity AI and no access to either system. Everything here comes from two files and four screenshots.',
        },
        {
          label: 'Dates',
          text: 'The deck is 22 July 2026. The demo cites evidence dated 7–8 August and captures dated 10 August. Sixteen to nineteen days separate them, and on one point they say different things.',
        },
      ],
      prose: [
        {
          dropCap: true,
          research:
            'Field study number five took a paragraph seriously. One paragraph, page 98, February 2026: a data spine for English education, with no architecture, no custodian, no budget and no date attached. The whole public record was three quotations. Five months later two documents arrived that are not part of that record at all. An eighteen-slide deck from Open Education AI and Edequity AI, and a self-contained clickthrough of what they call the node access layer. They are not the department’s. They are not a response to the consultation, which has not opened. They are somebody else’s answer, already partly running.',
          plain:
            'The government promised a data spine in one paragraph and said nothing else. Five months later, two other organisations turned up with part of one already working. This is me reading what they wrote.',
        },
        {
          research:
            'The deck’s own summary of where it stands is four numbers and three sentences: 37 organisations running the standard gold schema in production, 809 schools and around 445,000 pupils on one versioned schema refreshed nightly, a node access layer live in production across two UK regions as of July 2026, and four consumption surfaces. Then the sentence that made me keep reading: “The boundary, honestly: privacy tiers are recorded on every grant but the SDC/pseudonymisation transforms are the next build; the DP layer, spine central environment and research runner remain designed, not built. Nothing designed is described as built.”',
          plain:
            'The deck lists what is running: 37 organisations, 809 schools, one live layer, four ways to get data out. Then it lists what is not running, without being asked.',
        },
        {
          research:
            'That last sentence is a rule, and the deck keeps it. The demo section opens “Captured from the running system with its demonstration dataset”, and the first demo screen is stamped “Production surfaces · demonstration dataset · no pupil data”. The clickthrough goes further: its truth panel files six capabilities under “Not built / not claimed” — a live second node, email notifications, the code-to-data runner, differential privacy, dominance checks and protected-tier bulk export. I want to say this out loud before anything else in this study, because most of what follows is a reading against the grain of two documents that were unusually straight with me: the boundary in this study is theirs, not mine. I did not find it. They wrote it down.',
          plain:
            'They wrote their own limits down. I did not have to dig them out. That is worth saying before I start disagreeing with anything.',
        },
        {
          research:
            'So the two objects do not net off, and neither is a version of the other. The announced spine has the authority and no architecture — a paragraph, a consultation promised for summer 2026, an implementation window the white paper itself puts at 2028–29. The built federation has an architecture and no mandate: one live node, four consumption surfaces, and a sequencing rule stating that the minimum viable programme is funded independently before any Departmental dependency exists. Each one is short of exactly what the other has spare. That is not the same as one supplying the other.',
          plain:
            'One has power and no design. The other has a design and no power. They do not add up to a spine between them.',
        },
      ],
      figures: [
        {
          no: '1.1',
          chart: 'reach-span',
          unit: 'schools',
          cites: [1, 6],
          caption:
            'The demonstrated estate against the state-school census. The 809 is the deck’s own figure for 22 July 2026; the 22,018 is the census WhichMIS reconciles to. What this leaves out is the thing that would make it a fair fraction: the deck does not say how many of the 809 are English or state-sector, so the denominator is a join I made and neither source makes. Read it as an order of magnitude, not a share.',
          data: {
            spans: [
              {
                label: 'Schools on the standard gold schema',
                value: 809,
                of: 22018,
                unit: 'state schools in England',
                note: '37 organisations, around 445,000 pupils, one versioned schema refreshed nightly. Membership is stated as around 50 groups, so not every member is publishing.',
              },
              {
                label: 'Live nodes answering an ask',
                value: 1,
                of: 1000,
                unit: 'nodes at the national instrument the deck costs',
                note: 'Edequity — Marginal Gains NAL 1. The deck’s national scenario prices roughly 1,000 nodes; the demo says in terms that a second live node has not yet been stood up.',
              },
            ],
            foot: 'Both rows are the artefacts’ own numbers. Neither denominator is theirs.',
          },
        },
      ],
      pullQuote: 'One has the authority and no architecture. The other has the architecture and no mandate.',
      sections: [
        {
          template: 'T7',
          title: 'Two accounts, three weeks apart',
          claim: {
            text: 'The announced spine and the built federation ran on separate clocks and never once refer to each other. Neither document mentions the other.',
            confidence: 'fact',
            cites: [3, 1],
          },
          threads: [
            {
              name: 'The announced spine',
              detail:
                'One paragraph on page 98, a consultation promised for summer 2026, and an implementation window the white paper puts at 2028–29. No architecture, no custodian, no date.',
              tag: 'infrastructure',
            },
            {
              name: 'The built federation',
              detail:
                'A node access layer live in production across two UK regions, grant-gated and failing closed, with four consumption surfaces and one live node — and a boundary its own authors drew.',
              tag: 'operational',
            },
          ],
          entries: [
            {
              date: 'Feb 2026',
              title: 'The white paper commits to a spine',
              detail: 'One paragraph. Consultation promised for the summer; implementation put at 2028–29.',
              tag: 'infrastructure',
            },
            {
              date: 'Jul 2026',
              title: 'Portability, once',
              detail:
                'The same node software runs configuration-only in a customer-controlled cloud tenancy. Keys and storage stay in the customer’s environment. This is the software moved, not two nodes answering one ask.',
              tag: 'operational',
            },
            {
              date: '22 Jul 2026',
              title: 'The deck',
              detail:
                'Eighteen slides. Four consumption surfaces, 37 organisations on the gold schema, five phases A to E, and a boundary paragraph naming the SDC transforms as the next build.',
              tag: 'standards',
            },
            {
              date: '7–8 Aug 2026',
              title: 'The build note',
              detail:
                'The date the demo gives for its own evidence. Pseudonymisation and SDC on aggregate MCP answers are now on the built list; differential privacy, dominance checks, the code-to-data runner and protected-tier bulk export are not.',
              tag: 'standards',
            },
            {
              date: '10 Aug 2026',
              title: 'Four captures',
              detail:
                'Staging UI, seeded records, no pupil data: the OEAI register, node discovery, the ask composer and the controller gate.',
              tag: 'operational',
            },
            {
              date: 'Aug 2026',
              title: 'Two documents, one conversation',
              detail:
                'The announced spine still has no architecture. The built federation still has one live node. Nobody has put them in the same room.',
              tag: 'trust',
              present: true,
            },
          ],
          balance:
            'The two accounts do not net off. One thread accumulates authority without a design; the other accumulates a design without authority. A consultation that never reads the second thread will specify the first from scratch, and a federation that never enters the first will stay at one node.',
        },
      ],
      soWhat:
        'I went in expecting to find a pitch overstating itself and found a document doing the opposite. That changes what this study can usefully be. It is not an audit and it cannot be one — I ran nothing. It is a reading, and the most useful thing a reading can do here is take the boundary they drew and ask what sits just outside it.',
      openQuestion: {
        text: 'Has anyone put the two documents in front of the same people? The consultation has not opened, and neither artefact mentions the other.',
        falsifier: 'a departmental response, or a consultation document that names a federated node contract',
      },
    },

    // ——————————————————————————————————————————————————————————————
    {
      no: '02',
      slug: 'built',
      name: 'What is actually built',
      template: 'T2',
      minutes: 7,
      question: 'What is running, what is designed, and how would I know which is which?',
      claim: {
        text: '<b>The boundary is the artefacts’ own, and it is short.</b> Four consumption surfaces and one live node are claimed as production; the DP layer, the spine central environment and the research runner are named as designed, not built.',
        confidence: 'fact',
        cites: [1, 2],
      },
      standfirst:
        'Every row below is a statement one of the two artefacts makes about itself, with the artefact and its date against it. Nothing here was tested. That is the whole limitation of this beat, and it is on the page rather than in the footer.',
      marginNotes: [
        {
          label: 'Method',
          text: 'I have not verified a single row. A status here means one of two documents says so, on the date that document carries.',
        },
        {
          label: 'The one disagreement',
          text: 'On 22 July the SDC and pseudonymisation transforms are “the next build”. On 7–8 August they are “built and proven”, scoped to aggregate MCP answers. Read in date order that is a sequence, not a contradiction — but neither document records the crossing.',
        },
      ],
      prose: [
        {
          dropCap: true,
          research:
            'The deck’s status slide is titled “Where this stands — stated precisely”, and it earns the adverb. Four stat cards, then three sentences: the full loop exercised against production data, portability demonstrated rather than claimed, and the boundary. I have taken that boundary and laid it out as a table, adding what the clickthrough says three weeks later, because on one row the two documents do not agree.',
          plain:
            'The deck says exactly what is finished and what is not. Here it is as a table, with the clickthrough’s later version beside it.',
        },
        {
          research:
            'The four consumption surfaces are the part I keep returning to, because they are the built part and the deck’s summary line does not describe them. The publication floor — Parquet plus a signed manifest, checked aggregates only, never raw rows — sits on the diagram between a node and the spine core. Three of the four consumption surfaces are not on that path at all. The read API serves filtered JSON rows at pseudonymised or none; the BI/OData feed the same; bulk export serves tier none only in the current build, which the demo defines as “Identifiable / none · Real identifiers”, bounded to controller-owned storage and to within-organisation or appointed-processor use, with third-party protected-tier export refusing. That is not a concealed identifiable egress — the deck’s consumer slide is candid that on the tier ladder identifiable is almost never — but the one-page architecture has no line for the direct consumer read layer at all.',
          plain:
            'Four ways to get data out are working. Three of them serve rows rather than totals, and one of those serves real identifiers, bounded to the controller’s own storage. The one-page diagram does not draw them.',
        },
      ],
      survey: {
        // FOUR columns, and the numeric one is LAST: T2Survey prints the sigma
        // under `columns.length - 2` of the sliced header row, which is the
        // final column. A count column anywhere else prints the total under
        // the wrong heading.
        //
        // There was a fifth, "Stated where". It is gone because the table has
        // no fixed layout and long cells simply push the later columns out of
        // the frame — which put "Built or designed", the entire point of this
        // beat, behind a horizontal scroll. The provenance strip carries the
        // artefacts and their dates, and the rows that turn on which document
        // said what say so in their own cell.
        columns: ['Component or count', 'What the source says', 'Built or designed', 'Egress surfaces'],
        rows: [
          {
            cells: ['Node access layer', 'Two UK regions, fails closed', 'Built', undefined],
            basis: 'reported',
          },
          {
            cells: ['MCP for AI agents', 'Bounded tools · agg, pseudo+SDC', 'Built', 1],
            basis: 'reported',
          },
          {
            cells: ['Scoped read API', 'Filtered JSON rows · pseudo', 'Built', 1],
            basis: 'reported',
          },
          {
            cells: ['BI / OData feed', 'Live BI feed · pseudo', 'Built', 1],
            basis: 'reported',
          },
          {
            cells: [
              'Bulk export + signed manifest',
              'Signed Parquet · none tier only',
              'Built',
              1,
            ],
            basis: 'reported',
          },
          {
            // The one row where the two documents disagree. A survey cell is
            // not the place to explain that — the margin note and the
            // cannot-tell-you list carry it — so the cell states the status
            // and the date it changed on, and nothing else.
            cells: [
              'SDC + pseudonymisation',
              'Suppress under 10, round to 5',
              'Built after 22 Jul',
              undefined,
            ],
            basis: 'reported',
            pick: true,
          },
          {
            cells: [
              'Differential privacy layer',
              'Planned research tier',
              'Designed',
              undefined,
            ],
            basis: 'reported',
          },
          {
            cells: [
              'Spine central environment',
              'Signing, output checks, jobs log',
              'Designed',
              undefined,
            ],
            basis: 'reported',
          },
          {
            cells: [
              'Code-to-data research runner',
              'The contract’s fourth promise',
              'Designed',
              undefined,
            ],
            basis: 'reported',
          },
          {
            cells: [
              'A second live node',
              'Runbook exists; node does not',
              'Designed',
              undefined,
            ],
            basis: 'reported',
          },
          {
            cells: [
              '37 organisations · 809 schools · ~445,000 pupils',
              'One gold schema, nightly',
              'Built',
              undefined,
            ],
            basis: 'reported',
          },
          {
            cells: [
              '1 live node',
              'Edequity — Marginal Gains NAL 1',
              'Built',
              undefined,
            ],
            basis: 'reported',
          },
        ],
        total: {
          label: 'Consumption surfaces the deck counts as live',
          value: 4,
          reconciles: true,
        },
        provenance:
          'Every row is taken from one of two artefacts: the deck of 22 July 2026, or the clickthrough whose stated evidence is 7–8 August 2026 and whose captures are 10 August 2026. Where the two disagree the row says so. The four surface rows sum to the deck’s own count of four consumption surfaces; the node access layer row carries a dash rather than a four so the column is not double-counted, and every other row carries a dash because it is not an egress surface.',
        asOf: '22 July – 10 August 2026',
        cannotTellYou: [
          'Whether any of it works. Nothing here was tested. Every status is a statement by the people who built it, and I am repeating it, not confirming it.',
          'When the SDC and pseudonymisation transforms shipped. The deck calls them the next build on 22 July; the demo calls them built on 7 August. Neither records the crossing, and a reader holding only the July document has no way to learn the boundary moved.',
          'How many of the 809 schools are English or state-sector. The deck does not say. Any share taken against the 22,018 state census is a join I made, not one either source makes.',
          'What the four captured screens look like against real data. They were made on 10 August 2026 against a documented in-memory stub: the UI code is the staging implementation, the visible organisations and records are seeded, no Azure access and no pupil data.',
          'Whether the 37 organisations resemble the sector. Nothing in either artefact names a phase, an establishment type or an MIS supplier among them.',
        ],
      },
      soWhat:
        'The unbuilt list is short, and most of it is the kind of thing that gets built. What I would not have guessed from the summary line is which side of the boundary the publication floor sits on: the floor is drawn on the node-to-spine path, and three of the four built consumption surfaces are not on that path. The diagram and the surface list are describing different systems, and only one of them is the one running.',
      openQuestion: {
        text: 'Did the SDC and pseudonymisation transforms ship between 22 July and 7 August, or did the two documents scope the same claim differently? Neither says.',
        falsifier: 'a dated change record, or a build note that names the transform and the day it went in',
      },
    },

    // ——————————————————————————————————————————————————————————————
    {
      no: '03',
      slug: 'structure',
      name: 'Technical structure',
      template: 'T1',
      minutes: 7,
      question: 'Layer by layer, what has this design actually answered?',
      claim: {
        text: '<b>Exchange is answered in running software, and much of governance with it. The identifier layer is not answered at all</b> — the only identity bound anywhere is the consumer’s, not the child’s.',
        confidence: 'hypothesis',
        cites: [1, 2, 5],
      },
      standfirst:
        'The five layers are mine, from the study next door. Neither document uses them, so this whole beat is an overlay: a frame OEAI never agreed to, laid over a design that owes it nothing.',
      marginNotes: [
        {
          label: 'Overlay',
          text: 'Mapping their design onto my anatomy is an interpretive move. Where the fit is bad, the frame is more likely wrong than the design.',
        },
        {
          label: 'Not a gotcha',
          text: 'The identifier gap is not a thing they failed to do. Pupil identifiers staying inside the node is the design working. The gap is that the deck’s own flagship case needs a join across the boundary, and no source says how it is made.',
        },
      ],
      prose: [
        {
          dropCap: true,
          research:
            'The architecture page draws two consumption paths, not one. Checked aggregates rise through privacy transforms at the node and a universal publication floor — Parquet plus a signed manifest, checked aggregates only — into a spine core that never materialises pupil-level rows, and on to DfE feeds. Alongside it, on the same page, runs a second rail: approved jobs, code travels to data, feeding research access with application, ethics, approval, differential privacy plus code-to-data, and a public jobs log. Publish-then-consume for the departmental feed; request-then-compute for research. The deck marks the boundary itself: the DP layer, the spine central environment and the research runner remain designed, not built.',
          plain:
            'The diagram has two routes out of a school. One publishes checked totals upward. The other sends the analysis down to the data. The second route is not built yet, and they say so.',
        },
        {
          research:
            'So what the demo shows running is the first route’s surfaces without the first route. Its execution step is a direct agent-to-node call — authenticate, resolve live grants at each node, list tools within each grant, execute three aggregate tools locally, apply suppression and rounding at egress, sign provenance envelopes — over the live MCP contract’s tools/list and tools/call. There is no publication-floor-to-core hop anywhere in the ten scenes, and the demo’s own truth panel files the code-to-data runner under “Not built / not claimed”. What the demo does put in the loop is a central vetting authority, not a central data path: OEAI’s consumer register at steps one to three, which the deck calls the spine’s validation gate and which, in its own words, never sees a grant or a row.',
          plain:
            'In the demo the researcher’s agent talks straight to the node. Nothing passes through the middle except the check on who the researcher is.',
        },
        {
          research:
            'The read method is a first-class field of the ask — named node, read method, scope in the shared gold vocabulary, tier, justification — and in the demo it constrains which tier can be asked for at all. MCP carries aggregate-only, pseudonymised plus SDC, and none; the read API and the BI feed carry pseudonymised and none; bulk export carries none only in the current build. The enforcement rule is refusal rather than degradation: a surface that cannot apply the requested tier refuses rather than falling back to raw data. This is the Five Safes’ safe-settings idea moved off a physical access environment onto an API surface and put in front of the consumer at the moment of asking — my framing, not theirs; neither document invokes it. The narrower distinctive move is not the bounded catalogue, which is old news in federated analytics, but the grant deciding which of the catalogue an agent may even list: a grant scopes tools, not arbitrary SQL.',
          plain:
            'How you plan to read the data decides how protected it has to be, and you pick that before you ask. If a route cannot protect it the way you asked, it says no rather than giving you something rawer.',
        },
        {
          research:
            'On topology the deck and the study agree and were never going to disagree: N plus M, never N times M — one identity per consumer, one trust decision per node. My study already held that the centre holds identity, permission and audit while the records stay where they are generated, and marked that position a hypothesis. The two are not the same specification: the deck names no identity standard anywhere, and the study names OIDC, W3C Verifiable Credentials and the NHS CIS2 pattern, which is a technology choice rather than the algebra. What the deck adds is an answer where the study left a fork open. My custodian question was “who runs it, and who audits them?”, with three options — a DfE service, an arm’s-length body, or a genuinely federated arrangement with no single operator — and a warning that whoever holds the switchboard holds the power. The deck picks: a spine core described as charity-governed and deliberately small, with OEAI as a validation gate that vets who may consume and binds each consumer to a verifiable identity, and never sees a grant or a row. That is half my question answered and the other half untouched.',
          plain:
            'We agree on the shape: identity in the middle, records at the edges. I asked who should run the middle and listed three options. They picked a fourth. Nobody has said who audits it.',
        },
        {
          research:
            'The default is inverted, and that is the sharpest structural difference I found. My model runs on opt-out: a data-blind consent register of who has objected, applied before a query executes, enforced at source; one ask fans out, any gateway that opts out simply does not answer, and coverage drops with the result labelled partial. OEAI’s advert reverses the polarity — nothing exists until a controller affirmatively acts, and each approval prints “This opt-in created one revocable grant for this school group. The advert itself created nothing.” The property with no counterpart in my study is the concealment: the consumer cannot see which school groups matched before they opt in, and non-participating school-group identities are listed among what stayed inside. My model discloses non-participation to the asker as a named, labelled coverage shortfall. Both are defensible. They are not the same promise to the same person.',
          plain:
            'Mine assumes yes until someone objects. Theirs assumes no until someone agrees. And theirs hides who said nothing, where mine tells the researcher who is missing.',
        },
        {
          research:
            'Revocation is where the design argues with itself, gently. The deck states that revocation cuts the next request because the surfaces consult the register per read, so no credential lifetime keeps a revoked grant alive, and there is no bulk copy outside the node to chase. The first half is mechanism and it is claimed as built: audit, expiry and revocation sit on the demo’s built list, at one live node. The second half runs into the deck’s own inventory, which counts bulk export plus signed manifest among four live consumption surfaces, and the demo records that export running at the identifiable tier only. Per-read revocation cuts the next read. It cannot reach a Parquet extract already written — which is precisely the case my third reason for choosing federation was about: a record never copied can still be withheld; a record already in a warehouse cannot.',
          plain:
            'They can stop the next read, and that is real. They cannot pull back a file already exported, and one of the four live routes writes files.',
        },
      ],
      figures: [
        {
          no: '3.1',
          chart: 'gate-flow',
          unit: 'stage',
          cites: [1, 2],
          caption:
            'The governed path of one request, as the clickthrough walks it: ten scenes collapsed to the six points where an authority acts. The verdict row is the argument — asking is not access, and the thing that separates them is a person. What this leaves out is that the demo’s own gates constrain only its primary buttons: the rail, the arrow keys and the step hash navigate unconditionally, so a presenter can reach the last scene having approved nothing. Every state shown is seeded.',
          data: {
            stages: [
              {
                actor: 'OEAI',
                label: 'Invitation and vetting',
                holds: 'A single-use link, then an application. Approval alone reaches nobody: a machine identity must still be issued and bound.',
                verdict: 'pass',
              },
              {
                actor: 'Consumer',
                label: 'Discovery',
                holds: 'Signed aggregate capability statements — 9 matching school groups, 118 secondary schools. Totals, never names.',
                verdict: 'pass',
              },
              {
                actor: 'Consumer',
                label: 'The ask',
                holds: 'Named node, read method, scope in the gold vocabulary, tier, justification. The method constrains which tier may be requested at all.',
                verdict: 'pass',
              },
              {
                actor: 'Controller',
                label: 'At the gate',
                holds: 'Nothing. The advert appears independently at each matching controller and yields no data until a human releases it.',
                verdict: 'hold',
              },
              {
                actor: 'Node',
                label: 'Execution, locally',
                holds: 'Grants resolved per read, bounded tools listed within the grant, suppression and rounding applied at egress, provenance signed.',
                verdict: 'pass',
              },
              {
                actor: 'Node',
                label: 'A read with no grant',
                holds: 'Refused and logged. An application is never an authorisation, and the deck says it is enforced mechanically rather than by policy.',
                verdict: 'refuse',
              },
            ],
            foot: 'Six points, three verdicts. The fourth is the one the whole design exists to make expensive to skip.',
          },
        },
      ],
      pullQuote: 'The identity that gets bound is the consumer’s. Nobody, in either document, binds the child.',
      sections: [
        {
          template: 'T6',
          title: 'The five layers, overlaid',
          claim: {
            text: 'The identifier layer is the one with no answer at all. The resolution standard this study calls its single largest gap belongs to standards rather than to identifiers, and it is in neither document.',
            confidence: 'hypothesis',
            cites: [5, 1],
          },
          layers: [
            {
              no: 'L1',
              name: 'Identifier',
              question: 'who is this child?',
              today:
                'Neither artefact names UPN, ULN, NHS number, resolution or linkage. Pupil names and identifiers are listed among what stays inside the node, by design.',
              withIt:
                'Nothing on offer. The deck’s identity work binds the consumer to a verifiable identity; the child is never an entity in it.',
              theFight:
                'The flagship case needs an outcome label the schools do not hold — schools hold the predictors, local authorities hold the outcome labels — and no source says how the two sides are associated.',
              tag: 'identifier',
            },
            {
              no: 'L2',
              name: 'Index',
              question: 'who holds a record?',
              today:
                'Node discovery, one of the four captured screens. Signed aggregate capability statements: 9 matching school groups, 118 secondary schools. The consumer sees totals, not names.',
              withIt:
                'Criteria-first discovery at group granularity, never per-record pointers — a deliberately weaker answer than a record locator, and a real one.',
              theFight:
                'Concealing who matched is a feature here and a coverage problem in my model. The same mechanism protects a non-participant and hides a gap from the person interpreting the answer.',
              tag: 'infrastructure',
            },
            {
              no: 'L3',
              name: 'Exchange',
              question: 'how does it move?',
              today:
                'A node access layer live in production across two UK regions, grant-gated, failing closed, with four consumption surfaces and MCP tools/list and tools/call on the built list.',
              withIt:
                'Code-to-data: analysis travels to the node and runs inside it. Pupil-level data never leaves; answers do.',
              theFight:
                'That fourth promise is the one both documents place outside what is built. What runs today is bounded, pre-registered tools, not analyst-authored jobs travelling to a node.',
              tag: 'operational',
            },
            {
              no: 'L4',
              name: 'Standards',
              question: 'do we mean the same thing?',
              today:
                '37 organisations running one standard gold schema in production, refreshed nightly — a conformance contract rather than a public semantic layer. A node is a contract, not a product.',
              withIt: 'A conformance suite spanning at least two profiles, and a second provider. Both sit in Phase E, last of five, undated.',
              theFight:
                'The resolution standard is not here either. Nothing in either document says how a school-side record and a local-authority outcome are matched.',
              tag: 'standards',
            },
            {
              no: 'L5',
              name: 'Governance',
              question: 'who may ask, and who checks?',
              today:
                'Consumer register and identity binding, controller grants, audit, expiry and revocation — all on the built list, at one live node. Every administrative act dual-signed by operator and delegating controller.',
              withIt: 'A public jobs log from day one, and output checking done centrally rather than only at the node.',
              theFight:
                'Both belong to the central environment, which is designed and not built — and nothing in the deck names an auditor of OEAI itself.',
              tag: 'trust',
            },
          ],
          leastDesigned:
            'L1. Four layers have an answer of some kind. The identifier layer has none — and the deck’s own flagship case, the one it calls the flagship, needs it.',
        },
      ],
      soWhat:
        'I expected the disagreement to be about federation and it is not; on that we agree, and neither of us invented it. The disagreement is about the default and about the middle. They inverted my opt-out into an opt-in and hid the non-participants; they answered my custodian question with an option I had not listed. Both moves are defensible, both are load-bearing, and neither is a bug.',
      openQuestion: {
        text: 'How is a school-side pupil associated with a local-authority outcome, in this design? The flagship case turns on the join and neither document contains the word.',
        falsifier: 'a published resolution standard, or a statement that the design deliberately does not make that join',
      },
    },

    // ——————————————————————————————————————————————————————————————
    {
      no: '04',
      slug: 'representation',
      name: 'Visual representation',
      template: 'T1',
      minutes: 6,
      question: 'How is the argument drawn, and what does the drawing leave out?',
      claim: {
        text: '<b>Neither drawing encodes build status.</b> The architecture page uses four box treatments and none of them tracks what is built; the demo carries its boundary in words and in disabled attributes, not in its palette.',
        confidence: 'hypothesis',
        cites: [2, 1],
      },
      standfirst:
        'This beat is about the pictures, which sounds like the frivolous lens and is not. A diagram is a claim about what is one system and what is two, and a colour is a claim about what belongs with what.',
      marginNotes: [
        {
          label: 'Method',
          text: 'Read from a text extraction of the deck PDF plus a render of two of its pages, and from the demo’s shipped CSS and four embedded captures. An extraction is blind to vector artwork: absence in the text layer is not absence on the slide.',
        },
        {
          label: 'Own house',
          text: 'My study’s honesty is a build-failing test. Theirs is a sentence they chose to write. Mine catches a missing asOf date automatically; theirs caught a missing capability I would never have found.',
        },
      ],
      prose: [
        {
          dropCap: true,
          research:
            'The architecture page carries an instruction: “Read down as the path of an analysis; read up as the path of consent.” Every arrow glyph on the central stack runs downward — five of them, including consent’s own, which reads “consent and revocation gate everything at the node boundary”. The single upward triangle in the whole deck sits on the far-right rail that the label “benchmarking returns to participants” also occupies; the single downward one sits low on the left near “approved jobs — code travels to data”, pointing against the direction its own label implies. So consent appears twice on the page — as a gate on downward flow, and as an instruction about how to read the diagram — and never as an upward arrow of its own. The one depicted return path is benchmarking, which the deck does treat as a substantive output elsewhere: participants are first to receive what their participation creates.',
          plain:
            'The diagram tells you to read it upwards for consent. Every arrow on it points down. The only upward arrow belongs to the benchmarks going back to schools.',
        },
        {
          research:
            'The same page marks nothing about what is built. It has four different box treatments — a white box with a black hairline, a pale-blue fill with a blue border, a deeper fill with a heavy navy border used once, and faint grey outlines — and the variation tracks something, but not build status, and there is no legend. The unbuilt privacy-transforms row is drawn exactly like the in-production controllers row above it. The spine core, designed rather than built, carries the heaviest border on the page. Nor is the boundary a clean cut through the middle: the deck never puts the universal publication floor, sitting between two unbuilt rows, on the unbuilt side, and it counts bulk export plus signed manifest among four surfaces live in production. The sentence that draws the line arrives three slides later, as the third of three bullets, set at the same size as the two above it — typographic parity, under an eyebrow reading “Where this stands — stated precisely”. That is not burial. It is just not the diagram’s job, and the diagram never picks it up.',
          plain:
            'The picture uses four kinds of box and none of them means finished or unfinished. The unfinished bits look exactly like the finished ones.',
        },
        {
          research:
            'The demo does the opposite, and it is the better instrument for it. Its refusals are enacted in the affordance rather than only described: the differential-privacy tier is rendered with a real disabled attribute and labelled “Planned research tier; code-to-data + privacy budget not built”, so the audience cannot select the thing that is not built; the second node’s card is disabled and carries “The runbook and identity model exist. A second live node has not yet been stood up”; the compose button disables whenever bulk export is the chosen method. Four of the seven action toasts state what has not happened — invitation recorded, no data access created; admitted, but still reaches no node; identity bound, controller gates remain closed; advert published, still no access. And it survives the audience: the attendee build differs from the presenter build in exactly the narration machinery, while the amber “Guided simulation · sample data” pill and the full four-panel truth dialog, “Not built / not claimed” included, ship identically in both.',
          plain:
            'The clickthrough greys out the things it cannot do, with a real disabled button rather than a warning. The version handed to the audience keeps every one of those admissions.',
        },
        {
          research:
            'Where it is a clickthrough rather than a product, it shows. The governance gates constrain only the primary button: the continue button appears once two controllers are approved, and the compose button disables on export — but the rail, the progress dots, the arrow keys, Home, End and the step hash all navigate unconditionally, so a presenter can reach the research result having approved nothing, and the script’s final line seeds two approvals if the page loads directly on the last step with none. The composer’s review card is half-bound: tier and scope read live state beside a hardcoded method, and one screen later the controller’s grant line is a single static string — consumer, purpose, tier pseudonymised plus SDC, expiry January 2027, scope three tools — with no interpolation at all. Change the tier at step six and the composer follows while the gate does not. The demo’s own truth panel already files controller decisions and capability counts as illustrative, so this is a property of the walkthrough, not a finding about the product. But it is the one place the file’s code contradicts the file’s own narration, which asks the room to watch each controller see the same purpose, scope, tier, DSA and expiry.',
          plain:
            'The demo lets you skip the gates with the arrow keys, and the controller’s card is a fixed line of text rather than a copy of what you just chose. That is the slideshow, not the system — but it is the slideshow undercutting its own point.',
        },
        {
          research:
            'Colour is doing consistent work on the four product captures and inconsistent work in the demo shell. Across the captures the same three-way stat row recurs — a green count for a decision made, an ochre one for waiting on a person, a brick one for refused, counted in the same row rather than raised as an alarm — and on the two screens where the viewer holds an authority, the middle counter is the only one drawn inside a solid ochre rule. It looks like the emphasis tracks whose decision it is rather than stoppedness: on both of those screens the boxed count is the one the viewer must personally clear. The consumer workspace, where the viewer governs nothing, carries four counters, boxes none, and puts its held count first and unemphasised. In the demo shell, meanwhile, blue collapses: the coral and navy tokens are both the same hex, so the coral button class is the primary button class, and the hero’s three-authority card — meant to say that no actor can stand in for another — rules blue, blue, green.',
          plain:
            'On the real screens the colours mean something and hold. In the demo’s own stylesheet two colours are the same colour, so a card about three separate powers has two of them looking identical.',
        },
        {
          research:
            'One more, and it points at me. My study’s honesty is mechanical: the validator raises a build-failing error on a study whose claims contain no hypothesis anywhere — “A study with none is not being honest about its own reasoning” — on a survey with no asOf date, and on any instrument that does not state what it does not show. It only reports; it is the test asserting an empty error list that turns a violation red, and it currently runs against exactly one study. Theirs is a sentence its authors chose to write, plus hand-placed footnotes marking illustrative values, and nothing in either document describes a check that fails when one is missing. Mine would catch a missing date. Theirs caught an unbuilt runner. I am not sure which is the harder discipline.',
          plain:
            'My honesty rules are a test that fails the build. Theirs is a sentence someone decided to write. Mine catches small omissions automatically; theirs caught the big one.',
        },
      ],
      figures: [
        {
          no: '4.1',
          chart: 'build-state',
          unit: 'component',
          cites: [1, 2],
          caption:
            'The architecture page’s own rows, redrawn with the one thing its four box treatments do not encode. This is not the deck’s diagram — it is the deck’s content with a build-status legend added, which is exactly the change I am arguing for. What it leaves out is the architecture: a status list cannot show what gates what, which is the thing the original page draws well and this does not.',
          data: {
            rows: [
              { name: 'Node access layer', state: 'live', note: 'Two UK regions, grant-gated, fails closed. One live node.' },
              { name: 'Consumer register and identity binding', state: 'live', note: 'The validation gate. Never sees a grant or a row.' },
              { name: 'Grants, audit, expiry, revocation', state: 'live', note: 'Per-read register consultation, at one live node.' },
              { name: 'Four consumption surfaces', state: 'live', note: 'MCP, scoped read API, BI/OData feed, bulk export with a signed manifest.' },
              { name: 'Standard gold schema', state: 'live', note: '37 organisations, refreshed nightly.' },
              {
                name: 'SDC and pseudonymisation transforms',
                state: 'next',
                note: 'The one row the two documents date differently: next build on 22 July, built on 7–8 August, scoped to aggregate MCP answers.',
              },
              { name: 'Universal publication floor', state: 'designed', note: 'Parquet plus a signed manifest. Drawn between two unbuilt rows; never placed on either side.' },
              { name: 'Spine central environment', state: 'designed', note: 'Job signing, output checking, registers, the public jobs log, conformance.' },
              { name: 'Code-to-data research runner', state: 'designed', note: 'The node contract’s fourth promise.' },
              { name: 'Differential privacy layer', state: 'designed', note: 'Unselectable in the demo, and labelled as unbuilt where it is refused.' },
              { name: 'A second live node', state: 'designed', note: 'The runbook and identity model exist. The node does not.' },
            ],
          },
        },
        {
          no: '4.2',
          chart: 'counter-row',
          unit: 'counter',
          cites: [2],
          caption:
            'The three-counter row on the two captures where the viewer holds an authority. Redrawn rather than reproduced: the argument is about the device, and a screenshot would carry a great deal of seeded data that is not the argument. Only the middle counter sits inside a solid ochre rule, and on both screens it is the count the viewer must personally clear. What this leaves out is that the other two captures carry four counters and no rule at all — so this is a pattern on two screens, not on four. Every figure shown is a seeded value captured 10 August 2026 against an in-memory stub.',
          data: {
            screens: [
              {
                screen: 'Controller gate',
                role: 'the trust decides',
                counters: [
                  { label: 'Flowing now', value: 2, tone: 'done', note: 'live grants actively readable' },
                  { label: 'Held at the gate', value: 1, tone: 'waiting', note: 'awaiting your decision — receiving nothing', boxed: true },
                  { label: 'Refused', value: 1, tone: 'refused', note: 'reads blocked — no grant covered them' },
                ],
              },
              {
                screen: 'OEAI consumer register',
                role: 'the technical authority vets',
                counters: [
                  { label: 'Verified consumers', value: 2, tone: 'done', note: 'eligible to appear in controllers’ gates' },
                  { label: 'Awaiting identity binding', value: 1, tone: 'waiting', note: 'cannot reach any controller yet', boxed: true },
                  { label: 'Refused', value: 1, tone: 'refused', note: 'revoked or blocked from the registry' },
                ],
              },
            ],
            foot: 'Refusal is counted in the same row as success rather than raised as an alarm. That is a claim about what a refusal means here: routine, expected, and not a fault.',
          },
        },
      ],
      pullQuote:
        'The demo refuses what it cannot do with a real disabled attribute rather than a warning class. That is rarer than it sounds.',
      soWhat:
        'The deck draws the design it wants and the demo enacts the design it has, and the gap between them is exactly the gap the deck’s own boundary paragraph describes. If I were them I would put the boundary on the diagram — one legend, two fills — because the sentence three slides later is doing work no reader of the picture will do for it.',
      openQuestion: {
        text: 'Would a build-status legend on the architecture page cost them anything? I cannot see what, and I can see what it buys.',
        falsifier: 'a later version of the deck that marks built and designed on the diagram — or a good reason not to',
      },
    },

    // ——————————————————————————————————————————————————————————————
    {
      no: '05',
      slug: 'benefits',
      name: 'Benefits',
      template: 'T4',
      minutes: 5,
      question: 'What does this design buy, and for whom?',
      claim: {
        text: '<b>Three cost lines, kept separate — and the middle one is an estimate.</b> The deck prices the participation increment at tens of pounds a month and says the proof-of-concept replaces that engineering estimate with a measured number.',
        confidence: 'fact',
        cites: [1],
      },
      standfirst:
        'The economics are the part of this package I found most persuasive and least tested, which is an awkward combination and worth saying in that order.',
      marginNotes: [
        {
          label: 'Not measured',
          text: 'Every number on the cost slide is prospective. The twelve-week proof-of-concept is an ask of funders and school groups, not a run that happened.',
        },
        {
          label: 'The clock',
          text: 'The headline metric runs from “question locked” to a pooled published answer. My own trace starts twelve days earlier, at framing, and that difference is a third of the gap between our two numbers.',
        },
      ],
      ledger: {
        lenses: ['School group', 'Researcher', 'DfE', 'Parent', 'Operator / provider'],
        activeLens: 'School group',
        benefits: [
          {
            text: 'No new collection burden, no central store to breach, and a cost model that books the platform layer to the sector rather than to the spine — conflating them, the deck says, overstates the spine by an order of magnitude',
            confidence: 'fact',
            lenses: ['School group', 'DfE'],
            cites: [1],
          },
          {
            text: 'Benchmarking returns to participants: cross-trust comparison flows back to the organisations whose data makes it possible, and participation is priced to be better than cost-neutral for the sector',
            confidence: 'fact',
            lenses: ['School group', 'Operator / provider'],
            cites: [1],
          },
          {
            text: 'Consent is the mechanism rather than the obstacle — nothing exists until a controller affirmatively acts, and each opt-in creates one revocable grant while the advert itself creates nothing',
            confidence: 'fact',
            lenses: ['School group', 'Parent'],
            cites: [1, 2],
          },
          {
            text: 'The worked example refuses to invent a conclusion: the actual NEET outcome is not in the grant, and the named next requirement is a separately governed outcomes source or linkage rather than a finding',
            confidence: 'hypothesis',
            lenses: ['Researcher', 'Parent'],
            cites: [4, 2],
          },
        ],
        risks: [
          {
            text: 'The no-honeypot benefit is asserted as a property of the architecture rather than a policy commitment — but the component it belongs to, the spine core, is the same central environment the deck lists as designed, not built',
            confidence: 'hypothesis',
            lenses: ['Parent', 'DfE'],
            cites: [1],
          },
          {
            text: 'The scale figures are prospective: the increment is an engineering estimate, and the ~6–8 weeks is the headline metric of a twelve-week proof-of-concept that has not run',
            confidence: 'fact',
            lenses: ['DfE', 'Operator / provider'],
            cites: [1],
          },
          {
            text: 'The economics presuppose the very platform spend this study leaves unpriced and decisive for the long tail, and nothing in the deck characterises how the 37 organisations differ from the sector',
            confidence: 'hypothesis',
            lenses: ['DfE', 'Operator / provider'],
            cites: [1, 6],
          },
          {
            text: 'Two of the four products are absent from the clickthrough entirely — benchmarking and the value-return funding rule return no matches anywhere in it; the demo walks governed research access and nothing else',
            confidence: 'fact',
            lenses: ['School group', 'Operator / provider'],
            cites: [1, 2],
          },
          {
            text: 'The clock starts at “question locked”, which brackets out the twelve days of framing this study costs before that point, on a candidate question chosen so that it needs no new cross-domain linkage',
            confidence: 'hypothesis',
            lenses: ['Researcher'],
            cites: [5],
          },
        ],
        balance:
          'Read as a school group this tips clearly positive, and that is the design working as intended: the deck sets out to win a school’s trust and says so — schools say yes to questions they can see, scoped and revocable. Read as a parent it tips the other way, for the same reason. The words parent, family, guardian, citizen, data subject, objection and opt-out appear nowhere in either document. That is not an oversight so much as a choice of audience: OEAI’s answer to the parent is architectural, that the core never materialises pupil-level rows, plus a public jobs log that belongs to the environment they have not built yet.',
        byActor: [
          {
            actor: 'School group',
            gains: 6,
            loses: 3,
            net: 'positive',
            quote: 'Scoped, revocable, and the benchmark comes back to us first.',
          },
          {
            actor: 'Researcher',
            gains: 5,
            loses: 4,
            net: 'positive',
            quote: 'One notebook across heterogeneous nodes — when there is a second node.',
          },
          {
            actor: 'DfE',
            gains: 5,
            loses: 4,
            net: 'positive',
            quote: 'A consented feed instead of a collection. Phase D of five.',
          },
          {
            actor: 'Parent',
            gains: 2,
            loses: 7,
            net: 'negative',
            quote: 'Neither document contains the word parent.',
          },
          {
            actor: 'Operator / provider',
            gains: 5,
            loses: 4,
            net: 'positive',
            quote: 'We execute; the controller decides. Read-only governance metadata.',
          },
        ],
      },
      soWhat:
        'The cost argument is the cleanest thing in the deck, and it is clean partly because it is not measured yet. Three separated lines and a stated order-of-magnitude penalty for merging them is better discipline than most business cases manage. The thing I would want before believing it is the one thing the deck also wants: the twelve weeks, run.',
      openQuestion: {
        text: 'How much of the sector is already on an analytics platform? The whole economic argument rests on that penetration, and the deck asserts it without a figure.',
        falsifier: 'a published survey of analytics-platform coverage across English school groups',
      },
    },

    // ——————————————————————————————————————————————————————————————
    {
      no: '06',
      slug: 'limits',
      name: 'Limitations',
      template: 'T4',
      minutes: 5,
      question: 'What does this design not do, and what has not been shown?',
      claim: {
        text: '<b>Three of the gaps are not engineering.</b> Nothing in either artefact names an auditor of OEAI, admits a data subject to the cast, or says what protects consent-as-mechanism from a later statutory duty to supply.',
        confidence: 'contested',
        cites: [1, 2, 5],
      },
      standfirst:
        'The unbuilt list is short, honest and will shrink on its own. This beat is about the things that will not shrink on their own, and about the ones I am least sure of.',
      marginNotes: [
        {
          label: 'Escrow',
          text: 'Lock-in is answered — a node is a contract, not a product, hosting-neutral by contract, with one demonstrated configuration-only tenancy move. Escrow and a provider ceasing to trade are not mentioned anywhere, and the second provider sits in Phase E.',
        },
        {
          label: 'Fairness',
          text: 'A capture of the “Read activity” panel stops about a hundred pixels above the frame’s edge. That is a screenshot boundary, not a missing feature, and I nearly wrote it up as one.',
        },
      ],
      ledger: {
        lenses: ['Privacy advocate', 'Statistician', 'ICO', 'A future minister', 'Me'],
        activeLens: 'Privacy advocate',
        benefits: [
          {
            text: 'The boundary is volunteered rather than extracted: the deck names four things as not yet built and the demo files six under Not built / not claimed, including capabilities nobody had asked about',
            confidence: 'fact',
            lenses: ['Me', 'ICO'],
            cites: [1, 2],
          },
          {
            text: 'The demo blocks what it cannot support with a real disabled attribute rather than a warning class, and ships that apparatus unchanged into the attendee build',
            confidence: 'fact',
            lenses: ['Me', 'ICO'],
            cites: [2],
          },
          {
            text: 'Containment is real where accountability is thin: the vetting gate never sees a grant or a row, so a compromised gate admits a consumer who still receives nothing until a controller grants',
            confidence: 'fact',
            lenses: ['Privacy advocate', 'ICO'],
            cites: [1, 2],
          },
        ],
        risks: [
          {
            text: 'Nothing in the deck names an auditor of OEAI itself, no board or trustee structure appears anywhere in it, and capture is never raised as a risk — the vetting log records every decision without naming anyone entitled to read it',
            confidence: 'fact',
            lenses: ['Privacy advocate', 'ICO', 'Me'],
            cites: [1],
          },
          {
            text: 'The words parent, family, guardian, citizen, data subject, objection and opt-out appear nowhere in either artefact, and the audience for the audit trail is named as the regulator: read activity is the regulator-facing record',
            confidence: 'contested',
            lenses: ['Privacy advocate', 'Me'],
            cites: [1, 2, 5],
          },
          {
            text: 'Neither artefact describes any mechanism accounting for disclosure across repeated queries or across the answers pooled from several nodes; the implemented rule is per-answer suppression and rounding, and the controls that would compose are named and deferred',
            confidence: 'hypothesis',
            lenses: ['Statistician', 'ICO'],
            cites: [1, 2],
          },
          {
            text: 'The deck presents no representativeness, coverage, weighting or non-participation analysis — bias, representative, sample, weighting, selection, generalisability, coverage and population appear nowhere across the eighteen slides',
            confidence: 'fact',
            lenses: ['Statistician'],
            cites: [1],
          },
          {
            text: 'Withdrawal is booked only as a governance virtue; the proof-of-concept offers trusts review of outputs before publication and the benchmark first, and the deck nowhere books withdrawal correlated with results as an inferential cost',
            confidence: 'hypothesis',
            lenses: ['Statistician'],
            cites: [1],
          },
          {
            text: 'A node contract binds its parties, not a future minister — and neither document says what protects consent-as-mechanism from a later statutory duty to supply',
            confidence: 'contested',
            lenses: ['A future minister', 'Privacy advocate'],
            cites: [1, 5, 3],
          },
          {
            text: 'Neither artefact names a comparator — OpenSAFELY, X-Road, Ed-Fi and trusted research environments are all absent — and the one this study does hold is not ahead on the missing runner: OpenSAFELY Schools extracts into a segregated Azure tenancy and currently runs a direct SQL runner',
            confidence: 'fact',
            lenses: ['Me', 'Statistician'],
            cites: [7, 5],
          },
        ],
        balance:
          'The unbuilt list is the least worrying thing on this page, because it is short, it is theirs, and most of it is the kind of thing that gets built. The three that will not build themselves are an auditor, a data subject and a statute. None of them is engineering, all three are cheap relative to the cryptography already in the design, and the deck answers none of them — which is fair enough for an eighteen-slide architecture pitch, and is exactly why they should be conditions of the money rather than deliverables of Phase E.',
        byActor: [
          {
            actor: 'Privacy advocate',
            gains: 3,
            loses: 7,
            net: 'negative',
            quote: 'Revocation is real. So is the absence of anyone to exercise it on my behalf.',
          },
          {
            actor: 'Statistician',
            gains: 2,
            loses: 8,
            net: 'negative',
            quote: 'Show me the coverage, then show me who withdrew after seeing it.',
          },
          {
            actor: 'ICO',
            gains: 5,
            loses: 5,
            net: 'even',
            quote: 'Read activity is the regulator-facing record. That much was designed for me.',
          },
          {
            actor: 'A future minister',
            gains: 8,
            loses: 2,
            net: 'positive',
            quote: 'A node contract binds its parties. I am not one of them.',
          },
        ],
      },
      soWhat:
        'I went looking for the thing they had overstated and did not find one. What I found instead is a design whose remaining problems are all in the layer nobody can ship — who audits the auditor, who speaks for the child, and what happens the first time a minister finds a consented feed useful enough to compel.',
      openQuestion: {
        text: 'If withdrawal is correlated with what the benchmark says about you, the bias in a consented federation is a function of the published answer. Nobody has looked.',
        falsifier: 'a statistical design note that models correlated withdrawal, which the deck asks a research partner to co-author',
      },
    },

    // ——————————————————————————————————————————————————————————————
    {
      no: '07',
      slug: 'next',
      name: 'What I would do next',
      template: 'T3',
      minutes: 4,
      question: 'Having read both documents, what would I actually do?',
      claim: {
        text: '<b>Fund the twelve weeks, and attach two conditions neither document contains</b> — an auditor independent of whoever runs the exchange, and an access log a parent can read.',
        confidence: 'hypothesis',
        cites: [1, 5],
      },
      standfirst:
        'I have no money and no standing, so this is a recommendation to nobody in particular. It is still the honest end of the argument: having read both, this is what I would ask for.',
      marginNotes: [
        {
          label: 'Not an evaluation',
          text: 'I read two documents and four screenshots. I ran nothing, tested nothing and spoke to nobody. This beat is a reader’s recommendation, not an assessment.',
        },
      ],
      position: {
        statement: 'Fund the pilot. Ask for an auditor and a parent-visible log.',
        confidence: 'hypothesis',
        elaboration:
          'The twelve-week proof-of-concept is entirely within the programme’s gift, and the deck is explicit that it replaces an engineering estimate with a measured number. Two things should be conditions of the money rather than Phase E deliverables: an audit function independent of whoever runs the exchange, and an access log a family can read. Neither is expensive. Neither is in either document. Both are already conditions this study named before OEAI existed on my desk.',
        because: [
          {
            headline: 'The weakest number in the package is the one the pilot exists to replace.',
            detail:
              'The deck says so itself: the proof-of-concept replaces the engineering estimate with a measured number, and the ~6–8 weeks is a target for a run that has not happened. Everything else in the cost argument is separated cleanly and stated plainly. This is the load-bearing unknown, and twelve weeks settles it.',
          },
          {
            headline: 'The two missing pieces cost less than the cryptography already in the design.',
            detail:
              'This study scored a family-visible access log at 22 on its own trust ladder and a published shares register at 12, the register being invisible to individual families. The register is roughly what the deck offers, in the shape of a public jobs log — and that log belongs to the central environment, which is designed, not built.',
          },
          {
            headline: 'The deck answers my custodian fork with an option I had not listed, and leaves my condition unanswered.',
            detail:
              'The fork offered a DfE service, an arm’s-length body, or a federation with no single operator. The deck picks a charity-governed core with OEAI as validation gate. Its own closing condition in my study was an audit function independent of whoever runs the exchange, and the deck names none.',
          },
        ],
        rejected: [
          {
            name: 'Wait for the consultation',
            why: 'This is the study next door’s own recommendation — watch for the word custody — and it may still be right. But the consultation has not opened, the deck’s sequencing rule is explicit that none of this is the Department’s to move first, and the pilot is fundable now. Waiting produces no measured number for anybody.',
          },
          {
            name: 'Treat the vendor overlap as disqualifying',
            why: 'The dual role is disclosed on the title slide rather than concealed, OEAI has a separate Executive Chair, the demo names the operator as deciding nothing, and the deck says pre-existing work was bootstrapped by OEAI functionality and Edequity. The overlap is a reason to require an independent auditor. It is not a reason to refuse a twelve-week pilot.',
          },
          {
            name: 'Demand differential privacy before anything runs',
            why: 'The proof-of-concept fixes no DP, SDC only, as a non-goal in advance and says so on the page. Requiring the unbuilt layer first postpones the only thing that would generate evidence. The composition risk it addresses is real — but the answer to it is central output checking, which the deck already puts in its own architecture.',
          },
          {
            name: 'Publish this as an assessment of OEAI',
            why: 'It is not one, and calling it one would be the exact move the deck itself refuses when it declines to describe anything designed as built. I read two documents and four screenshots from the outside. That supports a reading, and a reading is what this is.',
          },
        ],
        conditions: [
          'An audit function independent of whoever runs the exchange',
          'A parent-visible access log, not only a published shares register',
          'A published resolution standard, or an explicit statement that the design does not need one',
          'A second, independently operated node before any conformance claim',
          'Central output checking on pooled answers, not only per-node suppression',
        ],
        sinkers:
          'If the twelve weeks run and the elapsed-days number comes back inside six to eight, the economics stand and most of this beat is noise, which would be the good outcome. What sinks the recommendation is the reverse: a pilot that never runs, or one that runs on a single node. One node cannot demonstrate one notebook across heterogeneous nodes, cannot exercise a conformance profile against a second, and cannot pool anything — so a single-node pilot would produce a number that measures nothing this design is actually claiming. If Phase E’s second provider stays in Phase E, the federation is a node, and the argument for it stays an argument about a design.',
        phases: [
          {
            label: 'Now',
            name: 'The auditor',
            detail: 'Named, and independent of whoever runs the exchange, before the money moves.',
          },
          {
            label: 'Now',
            name: 'The parent-visible log',
            detail: 'Cheaper than any of the cryptography already in the design, and worth more than all of it.',
          },
          {
            label: 'Phase A',
            name: 'The measured number',
            detail: 'Twelve weeks, two to three nodes, elapsed days from question locked to published answer.',
          },
          {
            label: 'Phase E',
            name: 'The second node',
            detail: 'Pulled forward. Every claim about heterogeneity waits on it.',
          },
          {
            label: 'Open',
            name: 'The resolution standard',
            detail: 'Still unwritten — in their two documents, and in mine.',
          },
        ],
      },
      soWhat:
        'The thing I did not expect to write is that the design is further along than the argument about it. There is a running node access layer with a governance model I would mostly defend, and the open questions left are the ones a document cannot close: an auditor, a family, and a statute. Those were my open questions in February too, against a completely different object. That is either a sign I am asking the right question or a sign I only know one.',
      openQuestion: {
        text: 'Do the twelve weeks ever get funded? Everything in this beat is downstream of an ask made to funders in July, and I have no way to see the answer.',
        falsifier: 'a published start date for the proof-of-concept, or a published decision not to run it',
      },
    },
  ],
};
