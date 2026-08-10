// system.ts — the content model for the system map on the index, plus the headline
// figures. Every count in STATS was computed from the source tree on 2026-08-05 by the
// command recorded in its `how` field; none of them are estimates.

export type BandId = 'surface' | 'engine' | 'reason' | 'memory' | 'world' | 'ground';

export interface Band {
  id: BandId;
  no: number;
  name: string;
  eli5Name: string;
  blurb: string;
  eli5Blurb: string;
}

export const BANDS: Band[] = [
  { id: 'surface', no: 1, name: 'Surfaces', eli5Name: 'The things you touch',
    blurb: 'Every way in. All of them are deliberately thick as a plank — none holds logic the others lack.',
    eli5Blurb: 'All the different ways you can talk to it. None of them is the "real" one.' },
  { id: 'engine', no: 2, name: 'Engines', eli5Name: 'The things that run',
    blurb: 'Four long-lived runners that own the actual work: conversation, automation, building, and self-improvement.',
    eli5Blurb: 'Four bits of software that actually do the work, each with a different job.' },
  { id: 'reason', no: 3, name: 'Reasoning', eli5Name: 'The thinking bit',
    blurb: 'One gateway to every model, with routing, caching and tool dispatch loitering in front of it.',
    eli5Blurb: 'One doorway to every AI, with the clever bits that pick which one and keep the cost down.' },
  { id: 'memory', no: 4, name: 'Memory', eli5Name: 'What it remembers',
    blurb: 'One database. Tables, loose records, vectors for meaning, and a graph for who-knows-whom.',
    eli5Blurb: 'One place where everything is kept — facts, files, and how things connect to each other.' },
  { id: 'world', no: 5, name: 'The world', eli5Name: 'The outside',
    blurb: 'Everything beyond the box that it can read from, or reach out and meddle with.',
    eli5Blurb: 'All the outside things it can look at or change.' },
  { id: 'ground', no: 6, name: 'Ground', eli5Name: 'Where it lives',
    blurb: 'The deeply unglamorous layer that decides whether any of the above still exists tomorrow morning.',
    eli5Blurb: 'The boring plumbing that keeps it alive.' },
];

export interface MapNode {
  id: string;
  band: BandId;
  label: string;
  /** One line, shown on hover. */
  what: string;
  /** Which section of the study explains it. */
  section?: string;
  /** Grid column (0-based) within its band. */
  col: number;
  /** Column span. */
  span?: number;
  /** Visually emphasised — the load-bearing pieces. */
  key?: boolean;
}

export const NODES: MapNode[] = [
  // ---- surfaces ----
  { id: 'site', band: 'surface', col: 0, label: 'The site', what: 'Blog, projects, field studies and decks — the public face. 144 page routes.' },
  { id: 'chat', band: 'surface', col: 1, label: 'Chat', what: 'The assistant hub. Threads, tools, costs per turn.', section: 'turn/stream', key: true },
  { id: 'canvas', band: 'surface', col: 2, label: 'Canvas', what: 'The visual workflow builder — drag nodes, wire them, schedule them.', section: 'reach/workflows' },
  { id: 'drive', band: 'surface', col: 3, label: 'Drive', what: 'Documents, with retrieval over them and a network-drive mount.', section: 'reach/drive' },
  { id: 'intel', band: 'surface', col: 4, label: 'Intel', what: 'The knowledge graph — people, organisations, threads and how they connect.', section: 'memory/channels' },
  { id: 'admin', band: 'surface', col: 5, label: 'Admin', what: 'Operations: models, connectors, secrets, health, the improvement log.', section: 'change/limits' },
  { id: 'wa', band: 'surface', col: 6, label: 'Messaging', what: 'The same assistant, reachable from a phone with no app installed.', section: 'turn/stream' },
  { id: 'mcp', band: 'surface', col: 7, label: 'MCP', what: 'An open protocol endpoint so an external assistant can drive this system directly.', section: 'reach/tools', key: true },

  // ---- engines ----
  { id: 'agent', band: 'engine', col: 0, span: 2, label: 'Agent runtime', what: 'Owns a conversation turn: assembles context, calls the model, dispatches tools, streams back.', section: 'turn/stream', key: true },
  { id: 'wfengine', band: 'engine', col: 2, span: 2, label: 'Workflow engine', what: '88 node types, triggers, branching, fan-in, retries — the automation substrate.', section: 'reach/workflows', key: true },
  { id: 'builder', band: 'engine', col: 4, span: 2, label: 'Builder', what: 'Writes whole applications, runs them in a container, iterates on the failures, publishes them.', section: 'change/nights' },
  { id: 'selfimp', band: 'engine', col: 6, span: 2, label: 'Self-improvement', what: 'Nightly. Reads how it has been doing, writes new tools, and refuses to install any that fail the gate.', section: 'change/nights', key: true },

  // ---- reasoning ----
  { id: 'gateway', band: 'reason', col: 0, span: 2, label: 'Model gateway', what: 'One account, every provider. Also the single point of failure — knowingly.', section: 'turn/routing', key: true },
  { id: 'router', band: 'reason', col: 2, span: 2, label: 'Model routing', what: 'Which model for which task, refreshed nightly against price and capability.', section: 'turn/routing', key: true },
  { id: 'cache', band: 'reason', col: 4, span: 2, label: 'Prompt cache', what: 'Marks the long unchanging prefix as cacheable. The largest single cost lever in the system.', section: 'turn/routing', key: true },
  { id: 'toolkit', band: 'reason', col: 6, span: 2, label: 'Toolkit', what: 'The tools the model may call — generated, not hand-written, so the inventory cannot drift.', section: 'reach/tools', key: true },

  // ---- memory ----
  { id: 'pg', band: 'memory', col: 0, span: 2, label: 'Postgres', what: '117 tables. One database for everything — no second store to keep in sync.', section: 'ground/storage', key: true },
  { id: 'datastore', band: 'memory', col: 2, label: 'Datastore', what: 'Schema-free collections for things not worth a migration, with row-level permissions and expiry.', section: 'memory/graph' },
  { id: 'vectors', band: 'memory', col: 3, span: 2, label: 'Vector index', what: 'Embeddings over documents, so retrieval works on meaning rather than exact words.', section: 'memory/retrieval' },
  { id: 'graph', band: 'memory', col: 5, span: 2, label: 'Knowledge graph', what: 'Entities and relationships, resolved and merged automatically overnight — every claim scored and decomposable.', section: 'memory/trust', key: true },
  { id: 'files', band: 'memory', col: 7, label: 'Files', what: 'Documents on disk and in object storage, addressable by the assistant.', section: 'ground/storage' },

  // ---- world ----
  { id: 'mail', band: 'world', col: 0, label: 'Mail', what: 'Watched inboxes that can start a workflow, and an assistant that can reply.', section: 'reach/workflows' },
  { id: 'cal', band: 'world', col: 1, label: 'Calendar', what: 'Read and write, across accounts.', section: 'reach/workflows' },
  { id: 'home', band: 'world', col: 2, label: 'Home', what: 'Home automation, browsable as areas and devices rather than a flat entity list.', section: 'reach/workflows' },
  { id: 'health', band: 'world', col: 3, label: 'Health', what: 'Wearable metrics from a strap, a phone and an activity log, normalised on read into one set of units.', section: 'reach/feeds' },
  { id: 'web', band: 'world', col: 4, span: 2, label: 'The web', what: 'Search, extraction, and a stealth browser for pages that will not be read any other way.', section: 'memory/research' },
  { id: 'git', band: 'world', col: 6, span: 2, label: 'Code host', what: 'Where the system opens pull requests against itself — as drafts, never merged by machine.', section: 'change/shipping', key: true },

  // ---- ground ----
  { id: 'origin', band: 'ground', col: 0, span: 2, label: 'Origin', what: 'A small server running the built application. No inbound port is open on it.', section: 'ground/estate' },
  { id: 'tunnel', band: 'ground', col: 2, span: 2, label: 'Tunnel + edge', what: 'Outbound-only tunnel to the edge, which caches, and is purged when a project goes private.', section: 'ground/estate' },
  { id: 'ci', band: 'ground', col: 4, span: 2, label: 'The pipeline', what: 'The only route to production. Gate first, deploy second, and the deploy cannot run if the gate is red.', section: 'change/shipping', key: true },
  { id: 'backup', band: 'ground', col: 6, span: 2, label: 'Backups', what: 'Encrypted, deduplicated, off-site, nightly — plus a separate escrow for the things that cannot be regenerated.', section: 'ground/storage' },
];

/** Directed flows worth drawing. Kept sparse on purpose — a map with every edge drawn is a hairball. */
export const FLOWS: Array<{ from: string; to: string; label: string }> = [
  { from: 'chat', to: 'agent', label: 'a turn' },
  { from: 'mcp', to: 'agent', label: 'external drive' },
  { from: 'wa', to: 'agent', label: 'from a phone' },
  { from: 'canvas', to: 'wfengine', label: 'a run' },
  { from: 'agent', to: 'toolkit', label: 'tool calls' },
  { from: 'agent', to: 'gateway', label: 'inference' },
  { from: 'wfengine', to: 'gateway', label: 'inference' },
  { from: 'selfimp', to: 'gateway', label: 'pinned model' },
  { from: 'builder', to: 'gateway', label: 'pinned model' },
  { from: 'gateway', to: 'cache', label: 'cached prefix' },
  { from: 'router', to: 'gateway', label: 'selection' },
  { from: 'toolkit', to: 'pg', label: 'reads + writes' },
  { from: 'toolkit', to: 'vectors', label: 'retrieval' },
  { from: 'toolkit', to: 'graph', label: 'entities' },
  { from: 'toolkit', to: 'web', label: 'search' },
  { from: 'wfengine', to: 'mail', label: 'watch + act' },
  { from: 'selfimp', to: 'git', label: 'draft PR' },
  { from: 'git', to: 'ci', label: 'merge' },
  { from: 'ci', to: 'origin', label: 'deploy' },
];

export interface Stat { value: string; label: string; how: string }

/** Headline figures. Every one computed by the command in `how`, on 2026-08-05. */
export const STATS: Stat[] = [
  { value: '406k', label: 'lines of source', how: 'every .ts, .svelte and .js file under src, concatenated and counted' },
  { value: '2,210', label: 'source files', how: 'find src -type f, filtered to ts/svelte/js' },
  { value: '117', label: 'database tables', how: 'pgTable declarations in the schema' },
  { value: '349', label: 'server endpoints', how: '+server.ts files under the routes tree' },
  { value: '144', label: 'page routes', how: '+page.svelte files under the routes tree' },
  { value: '613', label: 'components', how: 'all .svelte files under src' },
  { value: '88', label: 'workflow node types', how: 'register() calls in the workflow node registry' },
  { value: '219', label: 'test files', how: '.test.ts files under src' },
];

/** The claims the study has to earn. Shown on the index as the argument. */
export const CLAIMS: Array<{ n: string; title: string; body: string; eli5: string; section: string }> = [
  {
    n: '01', title: 'It is one system, not a pile of features', section: 'turn/stream',
    body: 'Write a tool for the assistant and a workflow can use it, the builder can use it, and so can an external client over an open protocol. Nothing is wired twice. That is the entire reason one middle-aged man can maintain a surface area this daft without the whole thing quietly falling over.',
    eli5: 'Everything shares the same parts. Teach it one new trick and every part of the system can use it immediately.',
  },
  {
    n: '02', title: 'The expensive thing is context, not compute', section: 'turn/cost',
    body: 'Nearly every cost and performance problem here turned out to be prompt size rather than code speed. Measured end to end, my own code is a rounding error in the wait. The work that actually pays is deciding what not to send — which is a much less satisfying thing to spend a Sunday on.',
    eli5: 'The slow, expensive part is how much you tell the AI — not how fast your own software is.',
  },
  {
    n: '03', title: 'It improves itself, but it cannot merge', section: 'change/nights',
    body: 'Every night it reads its own failures and writes improvements. Small self-contained tools it installs itself, after a static scan and a smoke test in which every case must pass. Anything bigger becomes a draft pull request with my name on the approval. There is no code path by which it can merge one, and I have gone looking for it more than once.',
    eli5: 'It fixes itself overnight — but only small, safe things. Anything bigger has to be approved by a human.',
  },
  {
    n: '04', title: 'Nothing it knows is a bare assertion', section: 'memory/trust',
    body: 'Eight channels feed one graph, and every claim in it carries a score that comes apart into who said it, how well it holds up, how many independent sources agree, whether a human signed it off, and what age has quietly taken off the top. A number you cannot take apart is just an opinion wearing a decimal point.',
    eli5: 'Everything it thinks it knows has a confidence rating — and the rating can always be broken down into the reasons behind it, so you can disagree with any one of them.',
  },
  {
    n: '05', title: 'A boundary, not a request', section: 'change/limits',
    body: 'Ask a model nicely not to do something and it will usually oblige. “Usually” is not a security property; it is a personality trait. So all but one of the guardrails here are boundaries instead — a container with no way out, a job that cannot start until another goes green, a scan that runs before anything is compiled, a credential the agent can use but never read, a tool with no parameter for the dangerous thing. Where the placement is what makes it hold, the page says where, and why.',
    eli5: 'Most of the safety features are things that simply cannot be done, rather than things it has been asked not to do.',
  },
];
