// trace.ts — content model for the flagship instrument: one message followed through
// six stages (across) and six layers (down).
//
// Structure copied from data-spine/trace/lib/trace.ts: STAGES × LAYERS gives a MATRIX of
// cells, and each SCENARIO supplies its own per-stage narrative and durations. The grid is
// the argument — every layer is happening at once, and you expand the one you asked about.
//
// Durations are in MILLISECONDS and are order-of-magnitude honest, not stopwatch-exact:
// they come from the instrumentation in src/lib/jkai/ttft-metrics.ts, the streaming
// analysis in docs/plans/2026-05-26-jkai-hermes-ttft-and-dead-air.md, and the shapes of
// real runs. Where a range is wide, the scenario says so.

export type StageId = 'arrive' | 'assemble' | 'route' | 'reason' | 'act' | 'answer';
export type LayerId = 'surface' | 'engine' | 'context' | 'model' | 'memory' | 'guard';
export type Depth = 'eli5' | 'engineering';

export interface Stage {
  id: StageId;
  no: number;
  name: string;
  eli5Name: string;
  blurb: string;
  eli5Blurb: string;
}

export interface Layer {
  id: LayerId;
  no: number;
  name: string;
  eli5Name: string;
  tag: string;
  question: string;
  eli5Question: string;
}

export const STAGES: Stage[] = [
  {
    id: 'arrive',
    no: 1,
    name: 'Arrive',
    eli5Name: 'You ask',
    blurb: 'The message reaches the origin and is bound to a thread.',
    eli5Blurb: 'Your message gets to the computer and is filed under the right conversation.',
  },
  {
    id: 'assemble',
    no: 2,
    name: 'Assemble',
    eli5Name: 'It gathers',
    blurb: 'The prompt is built: instructions, tools, history, and anything retrieved.',
    eli5Blurb: 'It works out what the assistant needs to know before it can answer you.',
  },
  {
    id: 'route',
    no: 3,
    name: 'Route',
    eli5Name: 'It picks a brain',
    blurb: 'A model is selected and a seller for it is chosen at the gateway.',
    eli5Blurb: 'It chooses which AI to use — they differ wildly in price, speed and skill.',
  },
  {
    id: 'reason',
    no: 4,
    name: 'Reason',
    eli5Name: 'It thinks',
    blurb: 'The model reads everything and decides: answer now, or call a tool first.',
    eli5Blurb: 'The AI reads it all and decides whether it can answer or needs to go look something up.',
  },
  {
    id: 'act',
    no: 5,
    name: 'Act',
    eli5Name: 'It does things',
    blurb: 'Tools execute against the real world, and their results are fed back in.',
    eli5Blurb: 'It actually goes and does the looking-up — reading mail, searching, running code.',
  },
  {
    id: 'answer',
    no: 6,
    name: 'Answer',
    eli5Name: 'You get it back',
    blurb: 'Tokens stream to the browser, the thread is persisted, the cost is booked.',
    eli5Blurb: 'The answer appears a word at a time, gets saved, and the cost is written down.',
  },
];

export const LAYERS: Layer[] = [
  {
    id: 'surface',
    no: 1,
    name: 'Surface',
    eli5Name: 'What you see',
    tag: 'browser · phone · chat',
    question: 'What is rendered, and what is the person told is happening?',
    eli5Question: 'What is on the screen right now?',
  },
  {
    id: 'engine',
    no: 2,
    name: 'Engine',
    eli5Name: 'The runner',
    tag: 'agent runtime · orchestrator',
    question: 'Which process owns this turn, and what is it doing with it?',
    eli5Question: 'Which bit of software is in charge at this moment?',
  },
  {
    id: 'context',
    no: 3,
    name: 'Context',
    eli5Name: 'What it knows',
    tag: 'prompt · tools · history',
    question: 'What is actually in the prompt at this instant — and what did it cost to put there?',
    eli5Question: 'What has the AI been told, and how much of that was worth telling it?',
  },
  {
    id: 'model',
    no: 4,
    name: 'Model',
    eli5Name: 'The AI itself',
    tag: 'gateway · seller · price',
    question: 'Which model, served by whom, at what price and what speed?',
    eli5Question: 'Which AI is doing the work, and what does a minute of it cost?',
  },
  {
    id: 'memory',
    no: 5,
    name: 'Memory',
    eli5Name: 'What it remembers',
    tag: 'postgres · vectors · graph',
    question: 'What is read from, and written back to, the permanent record?',
    eli5Question: 'What is it looking up, and what will it still know tomorrow?',
  },
  {
    id: 'guard',
    no: 6,
    name: 'Guardrail',
    eli5Name: 'The safety checks',
    tag: 'auth · limits · scans',
    question: 'What is being checked here, and what happens when the check fails?',
    eli5Question: 'What could go wrong here, and what stops it?',
  },
];

export interface Cell {
  /** Short label rendered in the collapsed row and as the cell heading. */
  label: string;
  /** The mechanism, 1–3 sentences. */
  detail: string;
  /** Plain-English version of the same. */
  eli5: string;
  /** Optional: this cell is where a known failure mode lives. */
  hazard?: string;
}

/** MATRIX[stage][layer] — what happens at that intersection, for any scenario. */
export const MATRIX: Record<StageId, Record<LayerId, Cell>> = {
  arrive: {
    surface: {
      label: 'Optimistic bubble',
      detail: 'Your message is painted immediately and an empty assistant bubble opens beneath it. Nothing has been sent anywhere yet — the UI does not wait for the network to acknowledge you.',
      eli5: 'Your message appears straight away, with an empty space under it where the reply will go.',
    },
    engine: {
      label: 'Thread bound',
      detail: 'The request lands on a server endpoint that resolves which conversation this belongs to, opens a job id, and hands the turn to the agent runtime. The job id is what every later event is keyed on.',
      eli5: 'The computer works out which conversation you are in and gives this exchange a ticket number.',
    },
    context: {
      label: 'Nothing yet',
      detail: 'At this instant the prompt is empty. Everything that will be in it is about to be a deliberate decision, and every one of those decisions has a price.',
      eli5: 'The AI has not been told anything yet.',
    },
    model: {
      label: 'Not chosen',
      detail: 'No model has been picked and no money has been committed. Choosing late means the choice can depend on what the message turns out to need.',
      eli5: 'No AI has been picked yet — that comes later, once it knows what you asked for.',
    },
    memory: {
      label: 'Turn opened',
      detail: 'A row is written for the turn before any work happens, so a crash mid-turn leaves a visible incomplete turn rather than silence.',
      eli5: 'It writes down that you asked something, before it starts — so nothing disappears if it falls over.',
    },
    guard: {
      label: 'Who are you?',
      detail: 'Session and ownership are checked at the edge. Most of this system is owner-only; the public surfaces are an explicit allow-list, not whatever was left unguarded.',
      eli5: 'It checks you are allowed to be here. Almost everything is private by default.',
      hazard: 'The allow-list is exact-prefix matched in one place only. A second, exact-match-only list exists for historical reasons and silently fails to match prefixes — using the wrong one is the classic way to lock anonymous users out of a page meant to be public.',
    },
  },
  assemble: {
    surface: {
      label: 'Thinking dots',
      detail: 'Three bouncing dots. This is the window where a system either feels alive or feels broken, and it is entirely about what you choose to show during work you have not finished.',
      eli5: 'The little animated dots that mean "hang on".',
    },
    engine: {
      label: 'Prompt assembly',
      detail: 'The runtime concatenates a layered prompt: standing instructions, the tool schemas, the recent turns, and any retrieved passages. Two separate prompt stacks exist — one for conversation, one for the builder — and they are deliberately not shared.',
      eli5: 'It writes a long briefing note for the AI: who it is, what it can do, what was said before, and anything it looked up.',
    },
    context: {
      label: 'The budget',
      detail: 'This is the expensive stage and the one nobody watches. Every tool schema, every stale instruction and every old turn is re-sent and re-billed on every single message. The lever on latency and cost is prompt size, not code speed.',
      eli5: 'Everything the AI is told gets paid for again on every message. Keeping that briefing short is the single biggest saving there is.',
      hazard: 'Measured end to end, the site’s own code accounts for a small fraction of the wait. Optimising the code while the prompt keeps growing is optimising the wrong thing.',
    },
    model: {
      label: 'Still not chosen',
      detail: 'Assembly is model-agnostic on purpose. The same assembled context can be sent to a cheap model or an expensive one without rebuilding it.',
      eli5: 'The briefing note is written so that any AI could read it.',
    },
    memory: {
      label: 'Retrieval',
      detail: 'If the message referenced documents or needed background, this is where the vector index and the knowledge graph are queried and the top passages are pasted in with their provenance attached.',
      eli5: 'If it needs to look things up in your files or notes, it does it now, and keeps a note of where each fact came from.',
    },
    guard: {
      label: 'Scope + secrets',
      detail: 'Retrieved content is filtered to what the requester may see. Credentials are never assembled into a prompt: the agent can use a stored credential by name, but cannot read its value.',
      eli5: 'It only pulls in things you are allowed to see, and it never puts passwords into the briefing note.',
    },
  },
  route: {
    surface: {
      label: 'Model chip',
      detail: 'The chosen model is shown, not hidden. If a request silently landed on something cheap and bad, you would want to know that from the interface rather than from the answer.',
      eli5: 'It shows you which AI it picked.',
    },
    engine: {
      label: 'Selection',
      detail: 'One default is resolved from settings and can be overridden per task. Background jobs pin their own model deliberately — the thing that edits code at 3am should not silently follow whatever the chat default became.',
      eli5: 'It picks an AI. Jobs that run overnight always use the same one on purpose, so they do not change behaviour without anyone noticing.',
    },
    context: {
      label: 'Cache breakpoints',
      detail: 'The assembled prefix is marked so the provider can cache it. Everything before the breakpoint is charged at a large discount on the next turn — as long as it is byte-identical. This is the single biggest cost lever in the system.',
      eli5: 'The long unchanging part of the briefing gets bookmarked, so next time the AI does not have to be charged for re-reading it.',
      hazard: 'Cache marking was originally only sent for one vendor’s models; every other model was silently paying full price for an identical prefix. Anything that varies the prefix — a timestamp, a reordered list — invalidates the cache and quietly restores full price.',
    },
    model: {
      label: 'Which seller',
      detail: 'A single gateway fronts every provider. But a model name is not one product: several sellers serve the same weights at different prices, precisions and speeds. Sorting purely by price tends to select a heavily quantised copy behind a long queue.',
      eli5: 'One doorway to every AI company. The catch: the same AI is sold by several shops, and the cheapest shop is often the slowest and the least accurate.',
    },
    memory: {
      label: 'Price list',
      detail: 'Per-model rates are held locally so a turn can be costed at the moment it happens rather than reconciled from a bill weeks later.',
      eli5: 'It keeps its own price list so it can tell you what each message cost, straight away.',
    },
    guard: {
      label: 'One key, one blast radius',
      detail: 'Routing everything through one gateway makes provider outages a single, legible failure instead of six different ones — at the cost of making that key a single point of failure. That trade was made knowingly.',
      eli5: 'Everything goes through one account. Simpler to manage, but if that account breaks, everything AI-powered stops.',
    },
  },
  reason: {
    surface: {
      label: 'First token',
      detail: 'The first visible character. Everything before it is dead air, and dead air is the thing users actually experience as slowness.',
      eli5: 'The first word appears. Up to now you have been staring at dots.',
    },
    engine: {
      label: 'Stream consumer',
      detail: 'Deltas are coalesced on a short interval so the UI is not repainted per token. The first delta is flushed immediately and only subsequent ones are batched — otherwise every reply starts a quarter of a second late for no reason.',
      eli5: 'Words are collected into small batches so the screen is not redrawn constantly — but the very first word is let through instantly.',
    },
    context: {
      label: 'Reasoning tokens',
      detail: 'Some models emit hidden reasoning before any visible output. Those tokens are billed and they consume the same output budget as the answer.',
      eli5: 'Some AIs think out loud privately first. You pay for that thinking, and it eats into the room left for the actual answer.',
      hazard: 'With a small output limit, a reasoning model can spend the entire budget thinking and return an empty answer. The fix is to either disable the thinking or raise the ceiling — not to retry and hope.',
    },
    model: {
      label: 'Deciding',
      detail: 'The model either answers directly or emits a tool call. This is the only genuinely non-deterministic step in the whole pipeline; everything either side of it is ordinary software.',
      eli5: 'The AI decides: answer now, or go and look something up first. This is the only step that is not predictable.',
    },
    memory: {
      label: 'Nothing written',
      detail: 'Reasoning is deliberately side-effect free. Nothing is committed until the model has actually asked for it.',
      eli5: 'Thinking changes nothing. Only doing does.',
    },
    guard: {
      label: 'Not the reply',
      detail: 'The runtime interleaves its own progress notices on the same channel as the answer. Those are recognised and routed off the text channel, so a status line can never overwrite a reply.',
      eli5: 'Progress messages and the real answer travel down the same wire; they are told apart so a "still working" note cannot wipe out your answer.',
      hazard: 'This exact failure happened: a recurring status line was not a prefix of its predecessor, the update was downgraded to a replace, and it overwrote the finished answer both on screen and in the database. The fix keeps text per message segment so a replace can only rewrite the segment it names.',
    },
  },
  act: {
    surface: {
      label: 'Tool cards',
      detail: 'Each tool call opens a card showing what is being run and, where possible, its progress. Long silent gaps are the enemy — a tool that takes three minutes with no signal reads as a hang.',
      eli5: 'You see a little card for each thing it goes off and does, so the wait is not silent.',
    },
    engine: {
      label: 'Dispatch',
      detail: 'The named tool is looked up and executed, its result serialised back into the conversation, and the model called again with the result appended. The loop repeats until the model stops asking for tools.',
      eli5: 'It runs the thing the AI asked for, hands back the result, and asks again — round and round until the AI is satisfied.',
    },
    context: {
      label: 'Results grow the prompt',
      detail: 'Every tool result is appended and re-sent on every subsequent iteration of the loop. A verbose tool is not a one-off cost; it is a tax on the rest of the turn.',
      eli5: 'Everything each tool returns gets added to the briefing and re-read every time round. A chatty tool costs you again and again.',
    },
    model: {
      label: 'Re-billed per hop',
      detail: 'Each iteration is a fresh billed call over an ever-larger prompt. This is where a turn quietly becomes expensive, and it is why prompt caching matters most here.',
      eli5: 'Each round trip is charged again over a longer briefing. This is where a simple question turns costly.',
    },
    memory: {
      label: 'Real effects',
      detail: 'This is the only stage that changes the world: mail is sent, records are written, files are stored, the graph gains entities. Everything here is logged with what asked for it.',
      eli5: 'This is where things actually happen — mail sent, notes saved, files written. All of it recorded.',
    },
    guard: {
      label: 'Destructive gate',
      detail: 'Operations that delete or overwrite are gated at the protocol boundary rather than inside any one caller, so a new caller cannot accidentally arrive without the check. Outbound fetches are filtered against private address ranges.',
      eli5: 'Anything that deletes or overwrites has to pass an extra check, placed where every route to it must go through it.',
      hazard: 'The outbound filter originally blocked private IPv4 addresses but not the IPv6 form of the same address, which is a well-known bypass. Blocking by shape rather than by string is the lesson.',
    },
  },
  answer: {
    surface: {
      label: 'The reply',
      detail: 'Markdown is rendered, citations become chips you can follow, and a small meter shows tokens per second and the cost of the turn just completed.',
      eli5: 'The finished answer, with clickable sources and a note of what it cost.',
    },
    engine: {
      label: 'Persist',
      detail: 'The assembled reply is written to the thread, reconstructed from per-segment text rather than one flat string, so a late edit to one segment cannot clobber the rest.',
      eli5: 'The answer is saved in pieces rather than one blob, so a late correction to one piece cannot destroy the others.',
    },
    context: {
      label: 'Becomes history',
      detail: 'This turn is now part of the prompt for the next one. Conversations get more expensive as they get longer, which is an argument for starting fresh threads more often than feels natural.',
      eli5: 'This exchange now becomes part of the briefing for your next message — which is why long conversations get slower and dearer.',
    },
    model: {
      label: 'Bill booked',
      detail: 'Input, output, cached and reasoning tokens are recorded separately against the turn, so cost can be attributed per conversation rather than appearing as one opaque monthly number.',
      eli5: 'It writes down exactly what this message cost, so the bill is never a mystery.',
    },
    memory: {
      label: 'Committed',
      detail: 'The thread row, the usage row and any entities extracted along the way are all committed. What happened is now recoverable from the database alone.',
      eli5: 'Everything is saved properly — you could reconstruct exactly what happened from the records.',
    },
    guard: {
      label: 'What leaves',
      detail: 'Anything rendered from model output is escaped before it is turned into HTML, and outbound content passes a sensitive-data check on the surfaces that publish.',
      eli5: 'Anything the AI wrote is made safe before it is put on a page, and checked for things that should not be published.',
      hazard: 'A detector like that exists in more than one copy in this codebase, and copies drift. The one that matters is the one on the path that actually publishes.',
    },
  },
};

export interface ScenarioStage {
  /** Machine time in ms for this stage. */
  ms: number;
  /** What is happening, for this scenario specifically. */
  say: string;
  /** Cumulative billed tokens after this stage (input + output, rounded). */
  tokens: number;
  /** Cumulative cost in US cents after this stage. */
  cents: number;
}

export interface Scenario {
  id: string;
  label: string;
  prompt: string;
  note: string;
  /** Which layer best repays watching for this scenario. */
  watch: LayerId;
  stages: ScenarioStage[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'calendar',
    label: 'A quick question',
    prompt: '“What’s on my calendar tomorrow?”',
    note: 'The ordinary case. One tool call, one round trip, back in a couple of seconds. Worth noticing how much of the time is assembly rather than thinking.',
    watch: 'context',
    stages: [
      { ms: 40, say: 'Message posted; thread resolved; job id issued.', tokens: 0, cents: 0 },
      { ms: 210, say: 'Instructions, tool schemas and eight recent turns assembled. No retrieval needed.', tokens: 4200, cents: 0.04 },
      { ms: 60, say: 'Default model resolved; cached prefix marked; a seller is chosen at the gateway.', tokens: 4200, cents: 0.04 },
      { ms: 900, say: 'Model reads the prompt and asks for the calendar tool rather than answering.', tokens: 4260, cents: 0.05 },
      { ms: 700, say: 'Calendar is queried for tomorrow; four events come back and are appended.', tokens: 4800, cents: 0.07 },
      { ms: 1100, say: 'Second call summarises the four events and streams the answer.', tokens: 5100, cents: 0.09 },
    ],
  },
  {
    id: 'research',
    label: 'A research request',
    prompt: '“Research how other countries handle this and write it up.”',
    note: 'The expensive case. Many tool calls, each one growing the prompt that every later call has to re-read. This is the shape that makes prompt caching matter.',
    watch: 'model',
    stages: [
      { ms: 40, say: 'Message posted; a research run is opened alongside the thread.', tokens: 0, cents: 0 },
      { ms: 340, say: 'Full toolkit assembled plus the research instructions — a noticeably larger prefix.', tokens: 6400, cents: 0.06 },
      { ms: 70, say: 'A stronger model is selected deliberately; the long prefix is marked cacheable.', tokens: 6400, cents: 0.06 },
      { ms: 2600, say: 'Model plans the search, then issues the first of many queries.', tokens: 7100, cents: 0.14 },
      { ms: 38000, say: 'Fourteen searches and nine page extractions. Every result is appended and re-sent on the next hop; the cached prefix is the only reason this is affordable.', tokens: 96000, cents: 2.4 },
      { ms: 9000, say: 'A structured write-up is produced with each claim carrying the source it came from.', tokens: 112000, cents: 3.1 },
    ],
  },
  {
    id: 'build',
    label: 'A build request',
    prompt: '“Build me a small app that does this.”',
    note: 'The agent writes code, runs it in a container, looks at what broke, and goes again. The interesting part is that nothing it writes touches the host.',
    watch: 'guard',
    stages: [
      { ms: 40, say: 'Build record created; the request becomes a brief.', tokens: 0, cents: 0 },
      { ms: 400, say: 'The builder’s own prompt stack is used — separate from the conversation one, on purpose.', tokens: 7800, cents: 0.07 },
      { ms: 70, say: 'A coding-capable model is pinned for the whole build rather than per message.', tokens: 7800, cents: 0.07 },
      { ms: 4200, say: 'A plan and a first file set are produced.', tokens: 14000, cents: 0.3 },
      { ms: 155000, say: 'Iterations: write, execute inside the sandbox container, read the failure, revise. The container is the boundary — the agent never runs code on the host.', tokens: 340000, cents: 9.8 },
      { ms: 3000, say: 'The bundle is published to a slug and served from disk, behind the same visibility gate as every other project.', tokens: 348000, cents: 10.1 },
    ],
  },
  {
    id: 'night',
    label: 'Nobody is watching',
    prompt: 'The nightly self-improvement run — no human involved',
    note: 'The same pipeline with the top layer empty. It reads how it has been doing, decides what to try, writes a tool, and refuses to install it unless it passes a static scan and every smoke case. Anything larger becomes a draft pull request for a human.',
    watch: 'guard',
    stages: [
      { ms: 0, say: 'No surface at all. A schedule fires; there is nobody to show a spinner to.', tokens: 0, cents: 0 },
      { ms: 2800, say: 'Recent failures, tool error rates and the surviving backlog are gathered into the prompt — including last night’s failure text, so the same mistake is not made twice.', tokens: 11000, cents: 0.05 },
      { ms: 60, say: 'A pinned model, not the chat default. The thing that edits the system must not drift when a preference changes.', tokens: 11000, cents: 0.05 },
      { ms: 21000, say: 'Candidate improvements are authored: new tools, repairs to failing ones, and larger changes that will need a human.', tokens: 46000, cents: 0.4 },
      { ms: 6000, say: 'The gate. A deny-list scan over the source, then every smoke case must pass — not most. A repair only replaces the incumbent if it strictly beats it on identical cases.', tokens: 52000, cents: 0.5 },
      { ms: 4000, say: 'Survivors are registered live. Bigger ideas open a draft pull request; the engine has no ability to merge one. A report is written for the morning.', tokens: 58000, cents: 0.6 },
    ],
  },
];

export const DAY = 86_400_000;

export function fmtDuration(ms: number): string {
  if (ms < 1) return '0 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m} min ${s} s` : `${m} min`;
}

export function fmtTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export function fmtCents(c: number): string {
  if (c === 0) return '—';
  if (c < 1) return `${c.toFixed(2)}¢`;
  if (c < 100) return `${c.toFixed(1)}¢`;
  return `$${(c / 100).toFixed(2)}`;
}

export const stageById = (id: StageId) => STAGES.find((s) => s.id === id)!;
export const layerById = (id: LayerId) => LAYERS.find((l) => l.id === id)!;
