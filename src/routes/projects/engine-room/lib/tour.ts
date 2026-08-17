// tour.ts — the site as a reader actually meets it: nineteen surfaces, in pictures.
//
// The system map on the index shows the architecture. Useful, but it is a diagram of
// things nobody can see. This is the other view: the actual pages, in the order you
// would stumble into them, each one wired to the part of the study that explains what
// it is doing.
//
// The screenshots are real, captured from a running instance by
// scripts/capture-engine-room-tour.ts, and redacted in the browser BEFORE the shot is
// taken — see that file for how, and for why painting over a bitmap afterwards is not
// good enough. Every name, place and filename you can read in one of these images is
// an invention.

export interface TourFeature {
  /** The thing you can do. */
  label: string;
  /** One line on what it actually does. */
  what: string;
  /** Where in the study it is explained — `part/slug`, matching nav.ts. */
  section?: string;
}

export interface Surface {
  id: string;
  tier: TierId;
  /** What the page is called. */
  label: string;
  /** The real path, shown as provenance. Not a link: most of these need a login. */
  route: string;
  /** Mono label above the title. */
  kicker: string;
  /** One sentence for the card and the top of the detail panel. */
  line: string;
  /** Whether an anonymous visitor can open it. */
  open: boolean;
  features: TourFeature[];
  /** Surfaces you can get to from here. Drives the hover lighting. */
  leads: string[];
}

export type TierId = 'front' | 'work' | 'machine';

export interface Tier {
  id: TierId;
  no: string;
  name: string;
  /** One line under the tier name. */
  lede: string;
  tone: string;
}

export const TIERS: Tier[] = [
  {
    id: 'front',
    no: 'I',
    name: 'The front of house',
    lede: 'What you get without a password. Looks like a blog, is a blog, is also the shop window for everything underneath.',
    tone: 'var(--accent-ink)',
  },
  {
    id: 'work',
    no: 'II',
    name: 'Where the work happens',
    lede: 'The assistant and everything it can reach. This is the bit that justifies the electricity bill.',
    tone: 'var(--accent)',
  },
  {
    id: 'machine',
    no: 'III',
    name: 'The machine room',
    lede: 'Dials, ledgers and a nightly shift that rewrites the place while I am asleep. Nobody was ever meant to see this room.',
    tone: '#8a2d3a',
  },
];

export const SURFACES: Surface[] = [
  // ---- I. the front of house ----------------------------------------------
  {
    id: 'home',
    tier: 'front',
    label: 'The landing page',
    route: '/',
    kicker: 'Public',
    open: true,
    line: 'A heartbeat, a mood, and a wall of tiles showing what the machine has actually been doing — live counts from the running system, not brochure numbers. The heart rate is mine.',
    features: [
      { label: 'Live vital signs', what: 'Tiles pull real counts from the running system rather than a figure I typed in once and forgot.', section: 'reach/feeds' },
      { label: 'The heartbeat line', what: 'Wearable data, normalised on read, because three devices had three opinions about what a step is.', section: 'reach/feeds' },
      { label: 'One thin surface', what: 'Every entry point is deliberately stupid. None of them holds logic the others lack.', section: 'turn/stream' },
    ],
    leads: ['blog', 'projects', 'decks', 'jkai', 'drive'],
  },
  {
    id: 'blog',
    tier: 'front',
    label: 'Writing',
    route: '/blog',
    kicker: 'Public',
    open: true,
    line: 'Ordinary posts, ordinarily neglected. The useful part is invisible: anything written here is indexed into the assistant’s memory, so writing a post also teaches the system something.',
    features: [
      { label: 'Drafts and previews', what: 'Unpublished posts get a token link, so a draft can be read without being indexed.', section: 'change/shipping' },
      { label: 'Indexed for the assistant', what: 'Posts are chunked into the same retrieval index the assistant searches. Writing something teaches it something.', section: 'memory/retrieval' },
    ],
    leads: ['home', 'drive'],
  },
  {
    id: 'projects',
    tier: 'front',
    label: 'Projects',
    route: '/projects',
    kicker: 'Public',
    open: true,
    line: 'Field studies, strategy games and a few things that started as a joke and refused to stop. Some carry an "AI Built" mark, meaning I described them once and went to bed.',
    features: [
      { label: 'Per-project visibility', what: 'Any project can be made private in one click, which also purges it from the edge cache.', section: 'ground/estate' },
      { label: 'Autonomously built entries', what: 'Several of these were written end to end by the builder from a single prompt.', section: 'change/nights' },
      { label: 'This very study', what: 'The Engine Room is itself a project page, which is either elegant or a warning sign.', section: 'turn/trace' },
    ],
    leads: ['home', 'decks', 'builds'],
  },
  {
    id: 'decks',
    tier: 'front',
    label: 'Decks',
    route: '/decks',
    kicker: 'Public',
    open: true,
    line: 'Slide decks generated from a prompt. A slide is a fixed page, so when the words do not fit they are cut rather than scrolled — the one honest thing PowerPoint never does.',
    features: [
      { label: 'Overflow is a failure, not a scrollbar', what: 'Text is measured against the stage. Too much content fails loudly instead of quietly running off the bottom.', section: 'reach/decks' },
      { label: 'Share tokens', what: 'A deck can be handed to someone outside without making it public to everyone.', section: 'reach/keys' },
    ],
    leads: ['projects', 'jkai'],
  },
  {
    id: 'releases',
    tier: 'front',
    label: 'The record',
    route: '/releases',
    kicker: 'Public',
    open: true,
    line: 'Every deploy this site has ever had, written up by a machine reading its own commit log. It exists so the record keeps itself: each entry is generated from what actually shipped, not from memory.',
    features: [
      { label: 'Written from the diff', what: 'Each entry is generated from the deployed commit range, so it cannot describe a change that did not ship.', section: 'change/shipping' },
      { label: 'Watch the language', what: 'Machine-written summaries get read before they publish. They are enthusiastic about things they should not mention.', section: 'change/limits' },
    ],
    leads: ['improvement', 'projects'],
  },

  // ---- II. where the work happens -----------------------------------------
  {
    id: 'jkai',
    tier: 'work',
    label: 'Chat',
    route: '/jkai',
    kicker: 'Owner only',
    open: false,
    line: 'The assistant. Threads down the left, the knowledge graph down the right, and a running total in the corner reminding me that curiosity costs about a tenth of a penny a go.',
    features: [
      { label: 'A price on every turn', what: 'Tokens and cost are shown per message. Nothing concentrates the mind like a live meter.', section: 'turn/cost' },
      { label: 'Pick your model, per chat', what: 'Any model from any seller, chosen per conversation, with a nightly re-scoring behind the default.', section: 'turn/routing' },
      { label: 'Tools it can actually call', what: 'Mail, files, the house, the graph, the web. The catalogue is generated, so it cannot drift from reality.', section: 'reach/tools' },
      { label: 'Answers arrive in pieces', what: 'Streaming with two accumulators, so a reply assembles without losing frames on the way.', section: 'turn/stream' },
    ],
    leads: ['canvas', 'intel', 'drive', 'builds', 'briefing', 'models'],
  },
  {
    id: 'canvas',
    tier: 'work',
    label: 'A canvas',
    route: '/jkai/canvas/<slug>',
    kicker: 'Owner only',
    open: false,
    line: 'Drag nodes, wire them together, put it on a timer. Eighty-eight node types, one of which will silently eat a branch if you join two paths the obvious way.',
    features: [
      { label: 'Eighty-eight node types', what: 'Triggers, models, parsers, actions. The same tools the assistant has, arranged as a diagram.', section: 'reach/workflows' },
      { label: 'The join that loses data', what: 'Two branches into one node merge flat, and a merge node does not fix it. Label the branches.', section: 'reach/workflows' },
      { label: 'Scheduled, in the right timezone', what: 'Cron runs on Europe/London, which was not true for an embarrassing length of time.', section: 'reach/workflows' },
      { label: 'Credentials it can use but not read', what: 'A node is handed a key by reference. It never sees the value.', section: 'reach/keys' },
    ],
    leads: ['canvases', 'briefing', 'jkai', 'health'],
  },
  {
    id: 'canvases',
    tier: 'work',
    label: 'All canvases',
    route: '/jkai/canvas',
    kicker: 'Owner only',
    open: false,
    line: 'Eighteen workflows, ninety-three nodes and a "needs attention" list that is my conscience rendered as a table.',
    features: [
      { label: 'Runs and success rates', what: 'Every execution is recorded, so a workflow that has been quietly failing for a week cannot hide.', section: 'reach/workflows' },
      { label: 'A nightly doctor', what: 'Something checks these for broken wiring at five in the morning and files what it finds.', section: 'change/nights' },
    ],
    leads: ['canvas', 'improvement'],
  },
  {
    id: 'builds',
    tier: 'work',
    label: 'Builds',
    route: '/jkai/builds',
    kicker: 'Owner only',
    open: false,
    line: 'Describe an application, go and do something else, come back to a working one. It plans first, writes second, runs the thing in a container, and argues with its own failures until they stop.',
    features: [
      { label: 'Plan before code', what: 'It writes a plan and a design system, then holds itself to both. Skipping this produced beautiful nonsense.', section: 'change/nights' },
      { label: 'It runs what it wrote', what: 'The build executes in a sandboxed container and iterates on real errors, not imagined ones.', section: 'change/gate' },
      { label: 'It remembers what failed before', what: 'Each build starts with the slice of build history that touches its files — verified fixes and hard-won lessons, keyed by file set and error.', section: 'change/lessons' },
      { label: 'A token ceiling', what: 'Capped per build, counting output tokens, because an unbounded agent is just a bill with ambition.', section: 'turn/cost' },
      { label: 'Publish to a real URL', what: 'A finished build can be promoted to a card on the projects page without a deploy.', section: 'change/shipping' },
    ],
    leads: ['projects', 'jkai', 'improvement'],
  },
  {
    id: 'intel',
    tier: 'work',
    label: 'The graph',
    route: '/jkai/intel',
    kicker: 'Owner only',
    open: false,
    line: 'Five hundred entities and five hundred connections, drawn as the hairball it genuinely is. Everything in here arrived from somewhere else and had to earn its place.',
    features: [
      { label: 'Eight doors in', what: 'Mail, files, chat, research, the web. They are not peers, and the graph records which door a fact came through.', section: 'memory/channels' },
      { label: 'Nothing is a bare assertion', what: 'Every claim carries a score that comes apart into who said it, how well it holds, and what age took off.', section: 'memory/trust' },
      { label: 'Exact, not approximate', what: 'Ranking is computed exactly and cached, rather than sampled. The page explains why that was the cheaper choice.', section: 'memory/graph' },
      { label: 'Standing questions', what: 'Ask it to watch something. It only speaks up when the movement clears a bar built to keep it quiet.', section: 'memory/watch' },
    ],
    leads: ['entities', 'jkai', 'drive', 'briefing'],
  },
  {
    id: 'entities',
    tier: 'work',
    label: 'Entities',
    route: '/jkai/intel/entities',
    kicker: 'Owner only',
    open: false,
    line: 'The register behind the graph: every person, place, project and idea it has met, with a confidence rating and a note on how it worked that out.',
    features: [
      { label: 'Is this the same person?', what: 'Ten signals, one threshold. Below it, two records stay two records — which is the safer mistake.', section: 'memory/entities' },
      { label: 'Duplicates, surfaced not merged', what: 'Possible matches are offered for review rather than silently joined, because an unmerge is much harder than a merge.', section: 'memory/entities' },
      { label: 'Typed, not tagged', what: 'Person, organisation, concept, risk, decision. The type changes what questions make sense.', section: 'memory/graph' },
    ],
    leads: ['intel', 'jkai'],
  },
  {
    id: 'briefing',
    tier: 'work',
    label: 'Morning briefing',
    route: '/jkai/briefing',
    kicker: 'Owner only',
    open: false,
    line: 'Seven every morning, on the phone, before the kettle. Weather, sleep, the house, the inbox — and a line under each one saying exactly which source coughed it up.',
    features: [
      { label: 'Every claim is traced', what: 'Sources that failed are listed as failed and excluded, rather than being quietly averaged into the summary.', section: 'memory/research' },
      { label: 'It says when it does not know', what: 'Three sources unavailable is printed on the page. A briefing that hides its gaps is a horoscope.', section: 'memory/trust' },
      { label: 'Built as a workflow', what: 'Twenty-four nodes on a canvas. Nothing bespoke — the same engine that does everything else.', section: 'reach/workflows' },
      { label: 'Rate it and it adapts', what: 'More like this, less of that. The feedback steers what tomorrow includes.', section: 'change/nights' },
    ],
    leads: ['canvas', 'intel', 'health'],
  },
  {
    id: 'drive',
    tier: 'work',
    label: 'Drive',
    route: '/drive',
    kicker: 'Owner only',
    open: false,
    line: 'Drop a file in and it becomes something the assistant can answer questions about. It also mounts as an ordinary network drive, because the fastest way into a clever system is a boring door.',
    features: [
      { label: 'Six kinds of file, six routes', what: 'A photograph has further to travel than a text file before it is searchable. The page shows the journey.', section: 'reach/drive' },
      { label: 'Grounded answers with citations', what: 'Chat over a selection of documents, with the answer pointing back at the page it came from.', section: 'memory/retrieval' },
      { label: 'Mounted over WebDAV', what: 'The same store appears as a network drive on the desktop.', section: 'reach/drive' },
      { label: 'Per-folder permissions', what: 'Who may read what is a property of the folder, checked on every call.', section: 'memory/store' },
    ],
    leads: ['jkai', 'intel', 'blog'],
  },

  // ---- III. the machine room ----------------------------------------------
  {
    id: 'admin',
    tier: 'machine',
    label: 'The console',
    route: '/admin',
    kicker: 'Owner only',
    open: false,
    line: 'Every connected system on one screen, each tile admitting how it is doing. The honest answer is usually "fine, and one thing is on fire".',
    features: [
      { label: 'One tile per subsystem', what: 'Content, connectors, models, secrets, health. Drill into any of them for the real controls.', section: 'change/limits' },
      { label: 'Generated from the topology', what: 'The map is built from a declared architecture file, so a new subsystem appears here without anyone remembering to add it.', section: 'ground/estate' },
    ],
    leads: ['models', 'improvement', 'costs', 'health', 'architecture'],
  },
  {
    id: 'models',
    tier: 'machine',
    label: 'Model routing',
    route: '/admin/ai/model-routing',
    kicker: 'Owner only',
    open: false,
    line: 'Four profiles, re-picked from the whole catalogue every night at four in the morning. Quality floor first, then price, so cheap-but-useless can never win on being cheap.',
    features: [
      { label: 'Nightly re-selection', what: 'The catalogue moves constantly. A model chosen by hand in March is a decision rotting quietly.', section: 'turn/routing' },
      { label: 'Which seller actually answered', what: 'The same model is served by several sellers at different speeds and precisions. Cheapest is often four-bit and slow.', section: 'turn/routing' },
      { label: 'First-try accuracy', what: 'Scored on whether a profile got the answer right first time, not on vibes.', section: 'turn/latency' },
      { label: 'One gateway, one failure', what: 'Every provider through one account. A single point of failure, chosen with eyes open.', section: 'turn/routing' },
    ],
    leads: ['costs', 'jkai', 'admin'],
  },
  {
    id: 'improvement',
    tier: 'machine',
    label: 'Self-improvement',
    route: '/admin/ai/improvement',
    kicker: 'Owner only',
    open: false,
    line: 'At half past three every morning it reads how badly it has been doing, writes tools to do better, and installs the ones that survive. It cannot merge anything. I checked. Twice.',
    features: [
      { label: 'Eight phases, six caps', what: 'Gather, learn, discover, build, repair, optimise, propose, report — each one bounded.', section: 'change/nights' },
      { label: 'A deny-list before compilation', what: 'Fourteen patterns a generated handler must not contain. It runs before the code is ever built.', section: 'change/gate' },
      { label: 'Every smoke case must pass', what: 'Not most. Every one. A tool that fails a single case is not installed.', section: 'change/gate' },
      { label: 'Bigger ideas become draft PRs', what: 'Anything beyond a self-contained tool is raised as a draft pull request. There is no code path by which it merges.', section: 'change/shipping' },
    ],
    leads: ['releases', 'canvases', 'admin'],
  },
  {
    id: 'costs',
    tier: 'machine',
    label: 'Cost tracking',
    route: '/admin/ops/costs',
    kicker: 'Owner only',
    open: false,
    line: 'What the thinking cost, by model, by agent, by tool. Thirty days of evidence that the expensive part was never the clever part.',
    features: [
      { label: 'Context, not compute', what: 'Almost every cost problem turns out to be prompt size. The work that pays is deciding what not to send.', section: 'turn/cost' },
      { label: 'Caching the long prefix', what: 'Marking the unchanging part of a prompt as cacheable made some calls dramatically cheaper. The largest single lever here.', section: 'turn/routing' },
      { label: 'Reasoning tokens count', what: 'Thinking is billed and it eats the output budget. A model can reason itself into producing nothing at all.', section: 'turn/cost' },
    ],
    leads: ['models', 'admin'],
  },
  {
    id: 'health',
    tier: 'machine',
    label: 'Connector health',
    route: '/admin/connections/health',
    kicker: 'Owner only',
    open: false,
    line: 'Every outside feed, and whether it is actually working — as opposed to whether a column in a database says it is working, which is a different and much more optimistic question.',
    features: [
      { label: 'Probe, never trust the column', what: 'Stored status is what happened last time. A live probe is what is true now, and they disagree more than you would like.', section: 'reach/feeds' },
      { label: 'Units are a trap', what: 'Three devices, three definitions of the same metric. Normalise on read or publish nonsense confidently.', section: 'reach/feeds' },
      { label: 'Parked is not broken', what: 'A feed can be deliberately dormant. Showing that as a failure trains you to ignore the failures.', section: 'reach/feeds' },
    ],
    leads: ['admin', 'briefing', 'architecture'],
  },
  {
    id: 'architecture',
    tier: 'machine',
    label: 'The estate',
    route: '/admin/ops/architecture',
    kicker: 'Owner only',
    open: false,
    line: 'A live map of the machines this runs on and whether they are answering. One codebase, several hosts, and strong opinions about which of them is allowed to do what.',
    features: [
      { label: 'Where it woke up decides what it may do', what: 'The same code behaves differently by host. Some subsystems refuse to run anywhere but home.', section: 'ground/estate' },
      { label: 'No inbound port', what: 'The origin server accepts nothing directly. Everything arrives through an outbound-only tunnel.', section: 'ground/estate' },
      { label: 'Four places a byte can live', what: 'And exactly one failure that no backup survives. The page names it.', section: 'ground/storage' },
    ],
    leads: ['admin', 'health'],
  },
];

export const byTier = (t: TierId) => SURFACES.filter((s) => s.tier === t);
export const surfaceById = (id: string) => SURFACES.find((s) => s.id === id);

/** Where the screenshots live. Written by scripts/capture-engine-room-tour.ts. */
export const shot = (id: string, size: 'thumb' | 'full' = 'thumb') =>
  `/projects/engine-room/tour/${id}${size === 'thumb' ? '-thumb' : ''}.webp`;

/**
 * When the screenshots were taken. Hardcoded rather than read from the manifest at
 * runtime: a public page must not couple to a build artefact, and a figure that goes
 * stale silently is worse than one that admits its date.
 */
export const CAPTURED = '17 August 2026';
