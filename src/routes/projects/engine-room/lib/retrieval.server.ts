// retrieval.server.ts — SERVER-ONLY lexical retrieval for this study's Ask dock.
//
// Pattern copied from data-spine/lib/retrieval.server.ts: BM25 with synonym expansion, a
// title boost and a per-source diversity cap, over a corpus assembled at module load from
// the study's own typed content constants. No build step, so the index cannot drift from
// what the pages actually say.
//
// A vector index would be the fashionable choice and the wrong one here: the corpus is a
// couple of hundred short passages, all written in the same voice, and a lexical ranker
// with a synonym table beats an embedding round trip on both latency and predictability at
// this size. The /memory section says so out loud, because choosing the simpler tool
// deliberately is part of what the study is arguing.

import { BANDS, NODES, STATS, CLAIMS } from './system';
import { TIERS as TOUR_TIERS, SURFACES, byTier, surfaceById, CAPTURED } from './tour';
import { BLOCKS, ROUTE, NIGHT_ROUTE, VERDICT, NIGHT_VERDICT } from './city';
import { STAGES, LAYERS, MATRIX, SCENARIOS } from './trace';
import { RESOLUTION, SELLER_FACTS, POLICY, CATALOGUE, CACHE_STORY, REASONING_ROWS } from './models';
import { WATCHDOG, STREAM_CONSTANTS } from './chat';
import { MANIFEST, TIERS, LESSONS, MCP_FACTS, WATERFALL } from './tools';
import { SIGNALS, PAIRS, RETRIEVAL, DATASTORE, GRAPH_FACTS, AUTO_MERGE } from './memory';
import { RESEARCH_FACTS, CONNECTOR_LESSON, SEARCH_LESSON, MERGED, GAPS, DESK } from './research';
import { CATEGORIES, ENGINE_FACTS, FANIN_STORY, DOCTOR, NODE_COUNT } from './automation';
import { PHASES, FORBIDDEN, CANDIDATES, BUILDER_FACTS } from './building';
import { PIPELINE, SAFETY, RISK_PATHS } from './shipping';
import { RAILS, PRINCIPLE, FAILURE_MODES } from './guardrails';

import { CHANNELS, SWEEP, HALVES, NEW_TEXT_ONLY, DECAY, DECAY_NOTE, CHANNEL_LESSON, UNGRADED, CADENCE } from './channels';
import {
  WEIGHTS, NEUTRAL, CORROBORATION_K, HALF_LIFE_DAYS, DECAY_FLOOR, UNASSESSED, BANDS as TRUST_BANDS,
  GRADE_LABEL, CREDIBILITY_LABEL, NEUTRAL_NOTE, SATURATION_NOTE, DECAY_NOTE as TRUST_DECAY, WHY_A_SCORE,
} from './trust';
import { FILE_KINDS, INDEX, HASH_GATE, VIRTUAL_FOLDERS, POLICY_RULES, DRIVE_FACTS, DRIVE_LESSON } from './drive';
import { STAGE, COUNTS, REGISTERS, OVERFLOW, CONSUMERS, REGISTRY_NOTE, COMPOSE_PATHS, FALLBACK_NOTE, SHARING, DECK_LESSON } from './decks';
import {
  FEEDS, ANALYTICS_COUNT, ANALYTICS_NOTE, SCALE, READINGS, FIXED_POINT, PROBES, HONESTY,
  CHEAP_BANNER, CATALOGUE as API_CATALOGUE, CATALOGUE_RULES, FEEDS_LESSON,
} from './feeds';
import {
  MACHINES, HOUSE_REASONS, HOUSE_COST, SUBSYSTEMS, ONE_REGISTER, FLAG_NOT_HOSTNAME, ESTATE_LESSON,
  STORES, BIG_INDEX, FAILURES, ESCROW_NOTE,
} from './ground';
import { CHECKS, CREDENTIALS, NEVER_READ, STORE_ONLY, EVERY_HOP, REQUEST_FLOW, NO_PARAMETER, FACTS as KEY_FACTS } from './keys';
import {
  ACTORS, WILDCARDS, PRECEDENCE, PER_ACTION, RECORDS as STORE_RECORDS, QUERY, QUERY_SAFETY,
  EXPIRY, REAPER, LEDGER, LIMITS as STORE_LIMITS, STORE_LESSON,
} from './store';
import { ENTITIES as HOUSE_ENTITIES, OPERATIONS as HOUSE_OPS, TREE_NOTE, DRY_RUN, MULTI, HOUSE_FACTS, HOUSE_LESSON } from './house';
import {
  ALARMS, THRESHOLDS as WATCH_T, BOTH_KINDS, ANCHOR, SNAPSHOT,
  LENS, LENS_RULES, LENS_FILTERS, STANDING, WATCH_LESSON,
} from './watch';
import {
  KEYS_NOTE, EVIDENCE as MEM_EVIDENCE, CHANNELS as MEM_CHANNELS, CORPUS as MEM_CORPUS,
  LATENCY as MEM_LATENCY, HYGIENE as MEM_HYGIENE, FEEDBACK as MEM_FEEDBACK, BASELINE as MEM_BASELINE,
  RELEVANCE as MEM_RELEVANCE, RESOLUTION as MEM_RESOLUTION, ANATOMY as MEM_ANATOMY,
  EDGE_KINDS as MEM_EDGE_KINDS, DEDUPE as MEM_DEDUPE, CGQL as MEM_CGQL,
  FINGERPRINT as MEM_FINGERPRINT, PROOF as MEM_PROOF, GRAPH_SURFACES as MEM_SURFACES,
} from './lessons';
import {
  TILE, PAD_STORY, BANDS as TRAIL_BANDS, SPORT_LABEL, NAISMITH,
  PLANNER as TRAIL_PLANNER, GUARDS as TRAIL_GUARDS, WHY_PRIVATE, PWA,
} from './trails';

export type SourceType =
  | 'overview' | 'trace' | 'models' | 'chat' | 'tools'
  | 'memory' | 'research' | 'automation' | 'building' | 'shipping' | 'guardrails'
  | 'channels' | 'trust' | 'drive' | 'decks' | 'feeds' | 'ground'
  | 'keys' | 'store' | 'house' | 'watch' | 'tour' | 'city'
  | 'lessons' | 'trails';

export interface Chunk {
  id: string;
  sourceKey: string;
  sourceType: SourceType;
  title: string;
  /** In-study link, so a cited passage can be opened. */
  url: string | null;
  text: string;
}
export interface Retrieved extends Chunk { score: number }

const B = '/projects/engine-room';

function buildChunks(): Chunk[] {
  const out: Chunk[] = [];
  const add = (c: Chunk) => out.push(c);

  // ---- overview ----
  for (const b of BANDS)
    add({ id: `band-${b.id}`, sourceKey: 'overview', sourceType: 'overview', title: `Layer ${b.no}: ${b.name}`, url: B,
      text: `${b.blurb} In plain terms: ${b.eli5Blurb}` });
  for (const n of NODES)
    add({ id: `node-${n.id}`, sourceKey: 'components', sourceType: 'overview', title: `Component: ${n.label}`, url: n.section ? `${B}/${n.section}` : B,
      text: n.what });
  add({ id: 'stats', sourceKey: 'overview', sourceType: 'overview', title: 'The size of the system', url: B,
    text: `Counted from source on 5 August 2026: ${STATS.map((s) => `${s.value} ${s.label} (${s.how})`).join('; ')}.` });
  for (const c of CLAIMS)
    add({ id: `claim-${c.n}`, sourceKey: 'claims', sourceType: 'overview', title: `Claim ${c.n}: ${c.title}`, url: `${B}/${c.section}`,
      text: `${c.body} Put simply: ${c.eli5}` });

  // ---- the visual tour of the site's own pages ----
  // Indexed so "what does the drive page do" or "which screens are there" is answerable.
  // Each feature is its own chunk pointing at the leaf that explains it, which is the
  // same relationship the tour draws on screen.
  for (const t of TOUR_TIERS)
    add({ id: `tier-${t.id}`, sourceKey: 'tour', sourceType: 'tour', title: `Tier ${t.no}: ${t.name}`, url: B,
      text: `${t.lede} It groups these pages: ${byTier(t.id).map((s) => s.label).join(', ')}.` });
  for (const s of SURFACES) {
    add({ id: `surface-${s.id}`, sourceKey: 'tour-pages', sourceType: 'tour', title: `${s.label} (${s.route})`, url: B,
      text: `${s.line} ${s.open ? 'Anyone can open it.' : 'It needs a login; the screenshot in the study is redacted.'} From it you can reach: ${s.leads.map((l) => surfaceById(l)?.label ?? l).join(', ')}.` });
    for (const f of s.features)
      add({ id: `surface-${s.id}-${f.label.slice(0, 18).replace(/\W+/g, '-').toLowerCase()}`, sourceKey: 'tour-features', sourceType: 'tour',
        title: `${s.label}: ${f.label}`, url: f.section ? `${B}/${f.section}` : B, text: f.what });
  }
  // ---- the two isometric set pieces on the index ----
  for (const b of BLOCKS)
    add({ id: `city-${b.id}`, sourceKey: 'city', sourceType: 'city', title: `The town: ${b.label}`,
      url: b.section ? `${B}/${b.section}` : B, text: b.what });
  add({ id: 'city-run', sourceKey: 'city', sourceType: 'city', title: 'One message, walked across town', url: B,
    text: `The index animates a single turn as a journey between six buildings: ${ROUTE.map((l) => l.caption).join(' ')} ${VERDICT.head} ${VERDICT.body}` });
  add({ id: 'city-night', sourceKey: 'city', sourceType: 'city', title: 'The same town at half past three', url: `${B}/change/nights`,
    text: `The second set piece runs the nightly self-improvement pass over the same six buildings: ${NIGHT_ROUTE.map((l) => l.caption).join(' ')} ${NIGHT_VERDICT.head} ${NIGHT_VERDICT.body}` });

  add({ id: 'tour-shots', sourceKey: 'tour', sourceType: 'tour', title: 'How the screenshots were made', url: B,
    text: `The screenshots in the tour are real, captured from a running instance on ${CAPTURED}. Personal data is replaced in the browser before the picture is taken, rather than painted over afterwards, so no real name, address, filename or key exists in the published image at all. Anything drawn on a canvas element — the knowledge graph paints its node labels as pixels — is redacted further upstream by rewriting the data before the page receives it.` });

  // ---- the trace ----
  for (const s of STAGES)
    add({ id: `stage-${s.id}`, sourceKey: 'trace-stages', sourceType: 'trace', title: `Stage ${s.no} of a turn: ${s.name}`, url: `${B}/turn/trace`,
      text: `${s.blurb} In plain terms: ${s.eli5Blurb}` });
  for (const l of LAYERS)
    add({ id: `layer-${l.id}`, sourceKey: 'trace-layers', sourceType: 'trace', title: `Layer ${l.no} of the stack: ${l.name} (${l.tag})`, url: `${B}/turn/trace`,
      text: `${l.question} In plain terms: ${l.eli5Question}` });
  for (const s of STAGES)
    for (const l of LAYERS) {
      const c = MATRIX[s.id][l.id];
      add({ id: `cell-${s.id}-${l.id}`, sourceKey: `trace-${s.id}`, sourceType: 'trace',
        title: `${s.name} × ${l.name}: ${c.label}`, url: `${B}/turn/trace`,
        text: `${c.detail} In plain terms: ${c.eli5}${c.hazard ? ` KNOWN FAILURE MODE: ${c.hazard}` : ''}` });
    }
  for (const sc of SCENARIOS)
    add({ id: `scenario-${sc.id}`, sourceKey: 'trace-scenarios', sourceType: 'trace', title: `Traced example: ${sc.label}`, url: `${B}/turn/trace`,
      text: `${sc.prompt} ${sc.note} Stage by stage: ${sc.stages.map((x, i) => `${STAGES[i].name} — ${x.say}`).join(' ')}` });

  // ---- models ----
  for (const r of RESOLUTION)
    add({ id: `res-${r.n}`, sourceKey: 'model-resolution', sourceType: 'models', title: `Model resolution layer ${r.n}: ${r.name}`, url: `${B}/turn/routing`,
      text: `${r.what} When it applies: ${r.when}` });
  add({ id: 'sellers', sourceKey: 'sellers', sourceType: 'models', title: 'Sellers: one model id, many providers', url: `${B}/turn/routing`,
    text: `A model name is not one product. One model id had ${SELLER_FACTS.endpointsAgentic} seller endpoints behind it, with an input-price spread of ${SELLER_FACTS.priceSpread} and a mix of full-precision, quantised and unadvertised endpoints. Sorting purely by price selects a heavily quantised copy behind the longest queue, while the quality index that chose the model was measured at full precision — so the selection optimises against something other than what is delivered. Per-endpoint latency and throughput were null on ${SELLER_FACTS.latencyNulls} endpoints, so seller ranking is delegated to the gateway's own sort rather than computed locally.` });
  add({ id: 'ttft-seller', sourceKey: 'sellers', sourceType: 'models', title: 'Latency is seller variance, not prompt length', url: `${B}/turn/latency`,
    text: 'Five consecutive calls with prompts of 18,000 to 22,000 tokens produced first-token times of 3.6s, 2.5s, 52.9s, 1.5s and 1.5s. The slowest call had the same prompt size as the fastest. The tell for this class of problem is same-size prompts with an order-of-magnitude latency spread. After sorting sellers by latency the worst first-token time fell from 52.9s to 7.6s and wall clock on the same task from 97s to 48s.' });
  add({ id: 'reasoning-floor', sourceKey: 'reasoning', sourceType: 'models', title: 'The reasoning-token floor and the empty answer', url: `${B}/turn/cost`,
    text: `Reasoning models emit hidden thinking tokens before any visible character, consuming the same output budget as the answer. ${REASONING_ROWS.map((r) => `At a budget of ${r.budget}: finish reason ${r.finish}, ${r.reasoning} reasoning tokens, output ${r.output ? `"${r.output}"` : 'EMPTY'}. ${r.verdict}`).join(' ')} The guard is central: requests to reasoning-capable models have their budget raised to a floor of 3,000 on the way out, so new call sites inherit it.` });
  add({ id: 'cache-story', sourceKey: 'caching', sourceType: 'models', title: 'Prompt caching — the largest single cost lever', url: `${B}/turn/cost`,
    text: `${CACHE_STORY.before} ${CACHE_STORY.after} ${CACHE_STORY.lesson} Caching only works while the prefix is byte-identical: a timestamp, a reordered list or a non-deterministic sort silently restores full price while everything continues to work.` });
  add({ id: 'auction', sourceKey: 'auction', sourceType: 'models', title: 'The nightly model auction', url: `${B}/turn/routing`,
    text: `At 04:00 the catalogue is re-scored for four profiles: general, tool use, retrieval and agentic. Of ${CATALOGUE.total} catalogued models, ${CATALOGUE.toolCapable} can call tools and ${CATALOGUE.rated} carry a quality index; ${CATALOGUE.eligible} survive eligibility, narrowing to between ${CATALOGUE.pools.agentic} and ${CATALOGUE.pools.rag} real candidates per profile. Policy: ${POLICY.map((p) => `${p.k} ${p.v} — ${p.why}`).join(' ')} Observed success feeds back as the lower bound of a 95% confidence interval, so one lucky answer cannot leapfrog a proven model. Unknown prices record null rather than zero, because a fabricated zero silently understates spend.` });

  // ---- conversation ----
  add({ id: 'hermes', sourceKey: 'engine', sourceType: 'chat', title: 'An external agent runtime behind the chat', url: `${B}/turn/stream`,
    text: 'Chat replies are not generated in the site process. A dedicated agent runtime owns the conversation, its tools and its session state, and the site translates its outbound frames into the event vocabulary the existing interface already spoke — fourteen frame kinds in, twenty event variants out. Both engines can therefore drive the same interface and the switch is a flag. The cost is that the site can no longer instrument the model call directly, so cost, throughput and liveness are reconstructed from the frame stream.' });
  add({ id: 'segments', sourceKey: 'frames', sourceType: 'chat', title: 'One reply, many message segments', url: `${B}/turn/stream`,
    text: 'The runtime opens a fresh message id at every tool boundary, so one reply arrives as a chain of segments, and it interleaves its own status bubbles on the same text channel, re-editing them in place. A flat accumulator treats a non-prefix edit as a whole-string replace, so a progress line overwrote a finished answer both on screen and in the database. The fix keeps text per segment in arrival order, so a replace can only rewrite the segment it names — and it is source-agnostic, holding for any future misbehaving frame rather than detecting this one.' });
  add({ id: 'accidental-invariant', sourceKey: 'frames', sourceType: 'chat', title: 'The accidental invariant', url: `${B}/turn/stream`,
    text: 'Routing the progress filler off the text channel was correct and immediately created a second fault: the four-minute idle watchdog had been getting reset entirely by accident by that periodic filler. Nobody designed it as a liveness signal. Behaviour a system depends on that nothing declares and no test covers is only discoverable by breaking it.' });
  add({ id: 'watchdog', sourceKey: 'watchdog', sourceType: 'chat', title: 'Timeouts chosen by what the turn is doing', url: `${B}/turn/stream`,
    text: `Silence is ambiguous, so the timeout depends on the activity. ${WATCHDOG.map((w) => `${w.tier}: ${w.idle} idle, ${w.hard} hard — ${w.why}`).join(' ')}` });
  add({ id: 'stream-consts', sourceKey: 'stream', sourceType: 'chat', title: 'Streaming constants', url: `${B}/turn/stream`,
    text: STREAM_CONSTANTS.map((c) => `${c.k}: ${c.v} — ${c.why}`).join(' ') });
  add({ id: 'resume', sourceKey: 'stream', sourceType: 'chat', title: 'Resume, never replay', url: `${B}/turn/stream`,
    text: 'Consumers append deltas, so replaying a buffer after a dropped connection silently doubled the reply — invisibly, because the server accumulates separately, which is why a page reload appeared to fix it. Every frame now carries its buffer index as the stream event id so the browser resumes precisely where it stopped.' });
  add({ id: 'presence', sourceKey: 'stream', sourceType: 'chat', title: 'A signal that is wrong exactly when needed', url: `${B}/turn/stream`,
    text: 'Deciding whether to escalate a finished long-running turn to a phone needs to know if anyone is watching. Subscriber count cannot answer it: the stream closes about ten milliseconds after a terminal event, so the count is zero by the time the grace period elapses whether or not someone is there. Presence is tracked separately on its own heartbeat with its own expiry.' });

  // ---- tools ----
  add({ id: 'manifest', sourceKey: 'manifest', sourceType: 'tools', title: 'The tool manifest budget', url: `${B}/reach/tools`,
    text: `There are ${MANIFEST.registered} tools, of which the model is shown ${MANIFEST.shown}: ${MANIFEST.essentials} essentials plus one dispatcher. Serialised in full the catalogue is ${MANIFEST.fullBytes.toLocaleString()} bytes, roughly ${MANIFEST.fullTokens.toLocaleString()} tokens of prefill re-sent on every message. As served it is ${MANIFEST.servedTokens.toLocaleString()} tokens, saving about ${MANIFEST.savedTokens.toLocaleString()} tokens per turn, at a cost of ${MANIFEST.dispatcherTokens} tokens for the dispatcher hiding the other ${MANIFEST.hidden}. Median prompt size per call is about ${MANIFEST.medianPrompt.toLocaleString()} tokens. Roughly ${MANIFEST.invokeShare}% of dispatcher calls go straight to invoke rather than browsing, which is what makes the indirection worth it.` });
  for (const t of TIERS)
    add({ id: `tier-${t.tier.slice(0, 10)}`, sourceKey: 'manifest', sourceType: 'tools', title: `Tool tier: ${t.tier}`, url: `${B}/reach/tools`,
      text: `${t.what} Cost: ${t.cost}. ${t.why}` });
  for (const l of LESSONS)
    add({ id: `toollesson-${l.title.slice(0, 14)}`, sourceKey: 'tool-lessons', sourceType: 'tools', title: l.title, url: `${B}/reach/tools`,
      text: `${l.body} Lesson: ${l.lesson}` });
  add({ id: 'waterfall', sourceKey: 'ttft', sourceType: 'tools', title: 'Where the 4.4 seconds goes', url: `${B}/turn/latency`,
    text: `Measured from submit to first visible character: ${WATERFALL.map((w) => `${w.label} ${w.ms}ms (${w.what})`).join('; ')}. The site's own code accounts for 87 milliseconds of about 4.4 seconds — under two per cent. Optimising it to zero would be imperceptible; removing tool descriptions from the prefill is felt on every message. Profile before optimising applies just as much when the slow part is not your software.` });
  for (const m of MCP_FACTS)
    add({ id: `mcp-${m.k.slice(0, 12)}`, sourceKey: 'mcp', sourceType: 'tools', title: `Protocol server — ${m.k}: ${m.v}`, url: `${B}/reach/mcp`, text: m.why });

  // ---- memory ----
  for (const s of SIGNALS)
    add({ id: `sig-${s.id}`, sourceKey: 'entity-resolution', sourceType: 'memory', title: `Matching signal: ${s.label}${s.base ? ` (${s.base})` : s.delta ? ` (+${s.delta})` : ''}`, url: `${B}/memory/entities`,
      text: `${s.what} ${s.why}` });
  add({ id: 'er-overview', sourceKey: 'entity-resolution', sourceType: 'memory', title: 'How entity resolution decides', url: `${B}/memory/entities`,
    text: `The strongest name-or-address signal sets a base confidence; structural corroboration (at least two shared connections in the graph) and semantic corroboration adjust it under a ceiling; conflicting addresses multiply it down and hold it below the bar rather than discarding the pair. Only a score of ${AUTO_MERGE} or above merges without a human. Worked cases: ${PAIRS.map((p) => `"${p.a}" vs "${p.b}" — ${p.story}`).join(' ')} It is algorithmic and explainable throughout; a language model is only a fallback where the rules find nothing, and its output is a possible match rather than a merge. Merging two people who are not the same person destroys information that re-running nothing can recover.` });
  add({ id: 'retrieval', sourceKey: 'retrieval', sourceType: 'memory', title: 'Retrieval and embeddings', url: `${B}/memory/retrieval`,
    text: RETRIEVAL.map((r) => `${r.k}: ${r.v} — ${r.why}`).join(' ') });
  add({ id: 'datastore', sourceKey: 'datastore', sourceType: 'memory', title: 'The flexible datastore', url: `${B}/memory/graph`,
    text: `Typed tables are right when the shape is known and stable, and wrong for the long tail where a migration costs more than the structure is worth. ${DATASTORE.map((d) => `${d.k}: ${d.why}`).join(' ')}` });
  for (const g of GRAPH_FACTS)
    add({ id: `graph-${g.title.slice(0, 14)}`, sourceKey: 'graph', sourceType: 'memory', title: g.title, url: `${B}/memory/graph`,
      text: `${g.body} Lesson: ${g.lesson}` });

  // ---- research ----
  add({ id: 'fabrication', sourceKey: 'fabrication', sourceType: 'research', title: 'Where fabrication comes from', url: `${B}/memory/research`,
    text: `Merging several sources into one narrative destroys the record of which source said what, and once that is gone an invented claim is indistinguishable from a supported one. In the worked example the merged answer produced: ${MERGED.map((m) => `"${m.text}" (${m.note})`).join(' ')} No fact is invented from nothing — two adjacent true facts are fused into a causal claim neither supports, which is both more plausible and harder to catch. The fix is structural: extract facts individually with their sources, then state explicitly what no source covers. ${GAPS.map((g) => `Gap: ${g}`).join(' ')} An instruction not to overstate is a request fighting the shape of the task, because bridging a gap IS what writing a flowing summary means. Giving the model somewhere else to put the gap changes what the task is.` });
  for (const r of RESEARCH_FACTS)
    add({ id: `res-${r.k.slice(0, 14)}`, sourceKey: 'research-run', sourceType: 'research', title: `Research runs: ${r.k}`, url: `${B}/memory/research`, text: r.why });
  add({ id: 'desk', sourceKey: 'research-desk', sourceType: 'research', title: 'The Research Desk — a table of facts, not a document', url: `${B}/memory/research`,
    text: `A finished run produces a corpus, not an essay. ${DESK.map((d) => `${d.k}: ${d.why}`).join(' ')} Composing prose is done FROM the table at the moment it is needed, and because the table survives, prose can always be regenerated with its provenance intact.` });
  add({ id: 'connector', sourceKey: 'dashboards', sourceType: 'research', title: CONNECTOR_LESSON.title, url: `${B}/memory/research`,
    text: `${CONNECTOR_LESSON.body} ${CONNECTOR_LESSON.fix}` });
  add({ id: 'websearch', sourceKey: 'dashboards', sourceType: 'research', title: SEARCH_LESSON.title, url: `${B}/memory/research`,
    text: `${SEARCH_LESSON.body} ${SEARCH_LESSON.fix}` });

  // ---- automation ----
  for (const c of CATEGORIES)
    add({ id: `cat-${c.id}`, sourceKey: 'node-categories', sourceType: 'automation', title: `Node category: ${c.name}`, url: `${B}/reach/workflows`, text: c.what });
  add({ id: 'engine', sourceKey: 'engine-facts', sourceType: 'automation', title: 'The workflow engine', url: `${B}/reach/workflows`,
    text: `${NODE_COUNT} node types across six categories. ${ENGINE_FACTS.map((f) => `${f.k} — ${f.v}: ${f.why}`).join(' ')}` });
  add({ id: 'fanin', sourceKey: 'fan-in', sourceType: 'automation', title: 'The fan-in collision', url: `${B}/reach/workflows`,
    text: `${FANIN_STORY.what} ${FANIN_STORY.worst} ${FANIN_STORY.incident} ${FANIN_STORY.trap} ${FANIN_STORY.fix} ${FANIN_STORY.now} The general lesson is that failing softly moves an error away from its cause: the transform that found nothing returned an empty string rather than throwing, which is defensive programming and is exactly what destroyed the evidence.` });
  add({ id: 'cron-utc', sourceKey: 'cron', sourceType: 'automation', title: 'Scheduled jobs run in UTC', url: `${B}/reach/workflows`,
    text: 'The server clock is UTC, and for a long time any schedule not explicitly naming a timezone inherited it — so an evening briefing arrived an hour late from late March to late October, every year, with no crash and nothing in a log. The interface even displayed the right timezone, and the schedule format accepted a timezone field that nothing read. The fix defaults schedules to a named human timezone rather than the server setting, because these schedules are written by a person for a person, in the hours of their own day.' });
  add({ id: 'doctor', sourceKey: 'doctor', sourceType: 'automation', title: 'The nightly workflow doctor', url: `${B}/reach/workflows`,
    text: DOCTOR.map((d) => `${d.k}: ${d.why}`).join(' ') });

  // ---- building ----
  for (const p of PHASES)
    add({ id: `phase-${p.id}`, sourceKey: 'nightly-phases', sourceType: 'building', title: `Nightly phase: ${p.name}`, url: `${B}/change/nights`,
      text: `${p.what}${p.note ? ` ${p.note}` : ''} In plain terms: ${p.eli5}` });
  add({ id: 'gate', sourceKey: 'verify-gate', sourceType: 'building', title: 'The verification gate on generated tools', url: `${B}/change/gate`,
    text: `Tools the engine builds are registered live with no restart and no approval step, which is only defensible because of the gate. Handlers are compiled in full runtime scope, so a deny-list scan over the raw source before compilation is not one layer among several — it is the layer. Forbidden constructs: ${FORBIDDEN.map((f) => `${f.pat} (${f.why})`).join('; ')}. Deny beats allow: an unknown construct is refused. Every violation is reported rather than the first, so one repair round can fix them all. Then a smoke test in which every case must pass, not most.` });
  for (const c of CANDIDATES)
    add({ id: `cand-${c.id}`, sourceKey: 'verify-examples', sourceType: 'building', title: `Gate example: ${c.label}`, url: `${B}/change/gate`,
      text: `${c.intent} ${c.verdict}` });
  add({ id: 'backlog', sourceKey: 'nightly', sourceType: 'building', title: 'Memory between nights', url: `${B}/change/nights`,
    text: 'Ideas persist in a backlog with an attempt count and the text of the last failure, and that failure text is fed into the next night’s authoring call. Without it the engine reattempts the same broken approach indefinitely, because each night begins with no knowledge of the last — and it looks busy the whole time. Repairs are swapped in only if they strictly beat the incumbent on identical smoke cases; a tie leaves the incumbent, because otherwise the system churns working code for the appearance of progress.' });
  add({ id: 'builder', sourceKey: 'builder', sourceType: 'building', title: 'The autonomous builder', url: `${B}/change/nights`,
    text: `A build is a loop, not a generation: write files, execute them, read the actual failure, revise. ${BUILDER_FACTS.map((f) => `${f.k} — ${f.v}: ${f.why}`).join(' ')} A prompt asking a model not to do something is a request; a container it cannot reach out of is a boundary.` });

  // ---- shipping ----
  for (const p of PIPELINE)
    add({ id: `pipe-${p.id}`, sourceKey: 'pipeline', sourceType: 'shipping', title: `Pipeline stage: ${p.name} (${p.where})`, url: `${B}/change/shipping`,
      text: `${p.what} Why it is shaped this way: ${p.why} In plain terms: ${p.eli5}` });
  for (const s of SAFETY)
    add({ id: `safe-${s.title.slice(0, 16)}`, sourceKey: 'deploy-safety', sourceType: 'shipping', title: s.title, url: `${B}/change/shipping`, text: s.body });
  add({ id: 'risk-tier', sourceKey: 'risk', sourceType: 'shipping', title: 'What a machine may merge by itself', url: `${B}/change/shipping`,
    text: `A change is diffed against the merge base and matched against a list of protected paths. Low tier from a machine-authored branch with a green gate can merge itself; high tier waits for a person. Protected: ${RISK_PATHS.map((r) => `${r.group} — ${r.why}`).join('; ')}. The agent’s own sandbox, confirmation gate and tool deny-list are all protected, so a change widening the machine’s own permissions can never be merged by the machine. The classifier never fails the build: a high tier is a normal outcome meaning a human looks at it, and making it a failure would train everyone to route around it.` });

  // ---- guardrails ----
  add({ id: 'principle', sourceKey: 'guardrails', sourceType: 'guardrails', title: PRINCIPLE.title, url: `${B}/change/limits`,
    text: `${PRINCIPLE.body} ${PRINCIPLE.tally}` });
  for (const f of FAILURE_MODES)
    add({ id: `fail-${f.title.slice(0, 14)}`, sourceKey: 'failure-modes', sourceType: 'guardrails', title: `How a guardrail fails without changing: ${f.title}`, url: `${B}/change/limits`,
      text: f.body });
  for (const r of RAILS)
    add({ id: `rail-${r.id}`, sourceKey: `rail-${r.id}`, sourceType: 'guardrails', title: `${r.rail} (${r.kind})`, url: `${B}/change/limits`,
      text: `Risk: ${r.risk}. ${r.detail}${r.note ? ` WHY IT IS PLACED THERE: ${r.note}` : ''}` });

  // ---- channels: where the graph's knowledge comes from ----
  for (const c of CHANNELS)
    add({ id: `chan-${c.id}`, sourceKey: 'channels', sourceType: 'channels',
      title: `Intel channel: ${c.label} (graded ${c.grade})`, url: `${B}/memory/channels`,
      text: `Words authored by: ${c.author}. It is ${c.arrival} — ${c.arrival === 'pushed' ? 'it arrives on its own' : c.arrival === 'pulled' ? 'something has to fetch it on a schedule' : 'it is a by-product of work done for another reason'}. Cost per item: ${c.cost}. Why it is graded ${c.grade}: ${c.why}` });
  add({ id: 'chan-lesson', sourceKey: 'channels', sourceType: 'channels', title: CHANNEL_LESSON.title, url: `${B}/memory/channels`,
    text: `${CHANNEL_LESSON.body} There are ${CHANNELS.length} channels feeding one knowledge graph: ${CHANNELS.map((c) => c.label.toLowerCase()).join(', ')}. All of them write into the same tables and are read by the same queries; what a channel gets to change is its grade, not its treatment.` });
  add({ id: 'chan-ungraded', sourceKey: 'channels', sourceType: 'channels', title: UNGRADED.title, url: `${B}/memory/channels`,
    text: UNGRADED.body });
  add({ id: 'chan-mail', sourceKey: 'mail-sweep', sourceType: 'channels', title: 'The mail sweep: a free half and a paid half', url: `${B}/memory/channels`,
    text: `The rolling window is ${SWEEP.windowDays} days — twelve weeks — of everything except bin and spam. ${HALVES.map((h) => `${h.label} (${h.cost}, ${h.confidence}): ${h.what} ${h.why}`).join(' ')} One run may list up to ${SWEEP.maxThreads.toLocaleString('en-GB')} threads, in pages of ${SWEEP.pageSize}, because listing is only ids and headers. It will pay for at most ${SWEEP.extractBudget} body extractions, newest first, so a first sweep of a large mailbox spreads over several nights instead of arriving as one enormous bill. A thread costs again only when a new message actually lands in it, because the content is hashed.` });
  add({ id: 'chan-quote', sourceKey: 'mail-sweep', sourceType: 'channels', title: NEW_TEXT_ONLY.title, url: `${B}/memory/channels`,
    text: `${NEW_TEXT_ONLY.body} The body is therefore cut at the first quote boundary and only new text survives, and a thread keeps at most ${SWEEP.maxMessages} messages. Beyond ${SWEEP.maxParticipants} participants a thread is treated as a broadcast rather than a conversation and no correspondence edges are drawn.` });
  add({ id: 'chan-decay', sourceKey: 'staleness', sourceType: 'channels', title: 'Staleness: evidence fades, and only halfway', url: `${B}/memory/channels`,
    text: `Edge weight decays exponentially with a ${DECAY.halfLifeDays}-day half-life to a floor of ${DECAY.floor}, never a cliff at the window edge — a cliff makes the graph lurch every night as threads age out. ${DECAY_NOTE.body} Only ${DECAY.pull * 100} per cent of a weight is exposed to age.` });
  add({ id: 'chan-cadence', sourceKey: 'chat-extraction', sourceType: 'channels', title: 'How often a conversation is re-read', url: `${B}/memory/channels`,
    text: `A thread is extracted into the graph as it grows. The old cadence — the second turn, then every fourth — was a near-total loss, because the median thread runs ${CADENCE.medianTurns} assistant turns, shorter than the gap: most threads extracted exactly once and everything said afterwards never reached the graph. It now extracts on every one of the first ${CADENCE.denseUntil} turns, every ${CADENCE.midEvery} up to turn ${CADENCE.midUntil}, and every ${CADENCE.lateEvery} after that — so a ${CADENCE.marathon}-turn marathon costs about ${CADENCE.newCost} extractions rather than ${CADENCE.oldCost}.` });

  // ---- trust: ratifying a knowledge artefact ----
  add({ id: 'trust-model', sourceKey: 'trust', sourceType: 'trust', title: 'The explainable confidence score', url: `${B}/memory/trust`,
    text: `Every claim in the knowledge graph carries a score from 0 to 1, and the score is additive by construction so its parts sum to it exactly — reliability ${WEIGHTS.reliability}, credibility ${WEIGHTS.credibility}, corroboration ${WEIGHTS.corroboration}, human confirmation ${WEIGHTS.confirmation}, less what age took off. That is what lets a card show "0.62 = 0.21 + 0.11 + 0.18 + 0.20 − 0.08" instead of an unexplained 62 per cent. A number you cannot decompose is an assertion wearing a decimal point.` });
  add({ id: 'trust-axes', sourceKey: 'trust', sourceType: 'trust', title: 'Two independent axes: Admiralty grading', url: `${B}/memory/trust`,
    text: `The grading is Admiralty-style (NATO STANAG 2511): source reliability A to F, and information credibility 1 to 6, kept independent because "who told you" and "does the claim hold up" are different questions. Reliability: ${Object.entries(GRADE_LABEL).map(([g, l]) => `${g} ${l}`).join('; ')}. Credibility: ${Object.entries(CREDIBILITY_LABEL).map(([c, l]) => `${c} ${l}`).join('; ')}.` });
  add({ id: 'trust-neutral', sourceKey: 'trust', sourceType: 'trust', title: NEUTRAL_NOTE.title, url: `${B}/memory/trust`,
    text: `${NEUTRAL_NOTE.body} An unassessed axis contributes ${NEUTRAL}, the midpoint. An entity nothing is known about therefore scores exactly ${UNASSESSED.toFixed(2)}, and the floor of the "low" band sits just above that so "we have not established this" is never labelled low confidence.` });
  add({ id: 'trust-corr', sourceKey: 'trust', sourceType: 'trust', title: SATURATION_NOTE.title, url: `${B}/memory/trust`,
    text: `${SATURATION_NOTE.body} The curve is n / (n + ${CORROBORATION_K}): strictly increasing, asymptotic to one, so two independent notes buys half the axis and nothing buys all of it.` });
  add({ id: 'trust-decay', sourceKey: 'trust', sourceType: 'trust', title: TRUST_DECAY.title, url: `${B}/memory/trust`,
    text: `${TRUST_DECAY.body} The half-life is ${HALF_LIFE_DAYS} days with a floor of ${DECAY_FLOOR}, and the decay multiplies only the evidence-derived components — a human confirmation is held out of it entirely.` });
  add({ id: 'trust-before', sourceKey: 'trust', sourceType: 'trust', title: WHY_A_SCORE.title, url: `${B}/memory/trust`,
    text: `${WHY_A_SCORE.body} Bands: ${TRUST_BANDS.map((b) => `${b.label} from ${b.from.toFixed(2)} — ${b.what}`).join(' ')}` });

  // ---- drive ----
  for (const k of FILE_KINDS)
    add({ id: `drive-${k.id}`, sourceKey: 'drive-kinds', sourceType: 'drive',
      title: `What happens to ${k.label.toLowerCase()} in the document store`, url: `${B}/reach/drive`,
      text: `For example ${k.example}. The path: ${k.path.join(' → ')}. ${k.note}` });
  add({ id: 'drive-index', sourceKey: 'drive', sourceType: 'drive', title: 'One index over every kind of file', url: `${B}/reach/drive`,
    text: `The always-on index is ${INDEX.globalDims} dimensions over every file; a collection you have chosen to talk to is built with a ${INDEX.collectionDims}-dimension embedding. ${INDEX.topK} passages are returned by default and anything below a similarity of ${INDEX.minSimilarity} is dropped rather than padding the list out; a passage carries at most ${INDEX.maxPassageChars} characters into a prompt. At most ${INDEX.maxIndexableMb} MB of a file is ever read into memory, because the always-on machine is memory-bound and one large file read whole would take the service down. ${DRIVE_LESSON.body}` });
  add({ id: 'drive-hash', sourceKey: 'drive', sourceType: 'drive', title: HASH_GATE.title, url: `${B}/reach/drive`, text: HASH_GATE.body });
  add({ id: 'drive-folders', sourceKey: 'drive-policy', sourceType: 'drive', title: VIRTUAL_FOLDERS.title, url: `${B}/reach/drive`,
    text: `${VIRTUAL_FOLDERS.body} ${POLICY_RULES.map((r) => `${r.setting}: ${r.rule} — ${r.why}`).join(' ')}` });
  add({ id: 'drive-facts', sourceKey: 'drive', sourceType: 'drive', title: 'What the document store provides', url: `${B}/reach/drive`,
    text: DRIVE_FACTS.map((f) => `${f.k} (${f.v}): ${f.why}`).join(' ') });

  // ---- decks ----
  add({ id: 'decks-stage', sourceKey: 'decks', sourceType: 'decks', title: OVERFLOW.title, url: `${B}/reach/decks`,
    text: `A slide is a fixed ${STAGE.w} by ${STAGE.h} canvas. ${OVERFLOW.body} Capacities the composer is given: ${REGISTERS.map((r) => `${r.label} about ${r.capacity} words — ${r.what} ${r.fix}`).join(' ')}` });
  add({ id: 'decks-registry', sourceKey: 'decks', sourceType: 'decks', title: 'One block registry, four consumers', url: `${B}/reach/decks`,
    text: `${CONSUMERS.map((c) => `${c.label}: ${c.what}`).join(' ')} ${REGISTRY_NOTE.body} There are ${COUNTS.layouts} page layouts, ${COUNTS.blocks} block types, ${COUNTS.proseStyles} prose registers and ${COUNTS.quoteStyles} quote registers, and ${COUNTS.effects} atmospheres and wipes (${COUNTS.backgroundEffects} backgrounds, ${COUNTS.transitionEffects} transitions).` });
  add({ id: 'decks-fallback', sourceKey: 'decks', sourceType: 'decks', title: 'The art director and its understudy', url: `${B}/reach/decks`,
    text: `${COMPOSE_PATHS.map((p) => `${p.label} (${p.when}): ${p.what}`).join(' ')} ${FALLBACK_NOTE.body}` });
  add({ id: 'decks-share', sourceKey: 'decks', sourceType: 'decks', title: 'Sharing a deck', url: `${B}/reach/decks`,
    text: `${SHARING.map((s) => `${s.k} (${s.v}): ${s.why}`).join(' ')} ${DECK_LESSON.body}` });

  // ---- feeds ----
  for (const f of FEEDS)
    add({ id: `feed-${f.id}`, sourceKey: 'feeds', sourceType: 'feeds', title: `External feed: ${f.label} (${f.arrival})`, url: `${B}/reach/feeds`,
      text: `Authorisation: ${f.auth}. Cadence: ${f.cadence}. What it carries: ${f.carries}. How it fails: ${f.fails}` });
  add({ id: 'feed-honesty', sourceKey: 'connector-health', sourceType: 'feeds', title: HONESTY.title, url: `${B}/reach/feeds`,
    text: `${HONESTY.body} Each probe does the cheapest thing that constitutes real evidence: ${PROBES.map((p) => `${p.label} — stored says "${p.stored}", a probe observes "${p.observed}" (${p.evidence})`).join('; ')}. Where a live probe would cost money the probe says it did not check rather than implying it verified something.` });
  add({ id: 'feed-banner', sourceKey: 'connector-health', sourceType: 'feeds', title: CHEAP_BANNER.title, url: `${B}/reach/feeds`, text: CHEAP_BANNER.body });
  add({ id: 'feed-scale', sourceKey: 'units', sourceType: 'feeds', title: 'Every measurement is an integer of hundredths', url: `${B}/reach/feeds`,
    text: `Health measurements are stored multiplied by ${SCALE}, so the number that comes out is the number that went in — no float, no drift, no rounding at ingest. ${READINGS.map((r) => `${r.label}: the column holds ${r.stored}, which means ${r.real}; forget and you read ${r.wrong}`).join('. ')}. ${FIXED_POINT.body}` });
  add({ id: 'feed-analytics', sourceKey: 'feeds', sourceType: 'feeds', title: ANALYTICS_NOTE.title, url: `${B}/reach/feeds`,
    text: `${ANALYTICS_NOTE.body} There are ${ANALYTICS_COUNT} of them.` });
  add({ id: 'feed-catalogue', sourceKey: 'api-catalogue', sourceType: 'feeds', title: 'Calling a data API nobody wrote code for', url: `${B}/reach/feeds`,
    text: `${API_CATALOGUE.seeded} public data sources are catalogued at boot and the model can search, call and register more. ${CATALOGUE_RULES.map((r) => `${r.k}: ${r.why}`).join(' ')} A call times out after ${API_CATALOGUE.timeoutSec} seconds and at most ${API_CATALOGUE.maxResponseKb} KB of a response is read, because a large body arrives as prompt tokens. ${FEEDS_LESSON.body}` });

  // ---- ground: the estate ----
  for (const m of MACHINES)
    add({ id: `machine-${m.id}`, sourceKey: 'estate', sourceType: 'ground', title: `Where it runs: ${m.label}`, url: `${B}/ground/estate`,
      text: `${m.strap} Why it exists: ${m.reason} What can reach it: ${m.exposure}` });
  add({ id: 'estate-gates', sourceKey: 'estate', sourceType: 'ground', title: 'One codebase, and the machine decides', url: `${B}/ground/estate`,
    text: `${ESTATE_LESSON.body} ${SUBSYSTEMS.map((s) => `${s.label} runs on ${s.runs.join(' and ')} (${s.gate} gate): ${s.why}`).join(' ')}` });
  add({ id: 'estate-house', sourceKey: 'estate', sourceType: 'ground', title: 'Why anything runs on a machine at home', url: `${B}/ground/estate`,
    text: `${HOUSE_REASONS.map((r) => `${r.k}: ${r.why}`).join(' ')} ${HOUSE_COST.body}` });
  add({ id: 'estate-register', sourceKey: 'estate', sourceType: 'ground', title: ONE_REGISTER.title, url: `${B}/ground/estate`,
    text: `${ONE_REGISTER.body} ${FLAG_NOT_HOSTNAME.body}` });

  // ---- ground: storage ----
  for (const s of STORES)
    add({ id: `store-${s.id}`, sourceKey: 'storage', sourceType: 'ground', title: `Storage: ${s.label}`, url: `${B}/ground/storage`,
      text: `Holds: ${s.holds} Why here: ${s.why} What losing it costs: ${s.loss}` });
  add({ id: 'store-index', sourceKey: 'storage', sourceType: 'ground', title: BIG_INDEX.title, url: `${B}/ground/storage`, text: BIG_INDEX.body });
  add({ id: 'store-failures', sourceKey: 'recovery', sourceType: 'ground', title: 'What survives what', url: `${B}/ground/storage`,
    text: FAILURES.map((f) => `${f.label} — recovered by ${f.recovers.join(', then ')}. ${f.cost}`).join(' ') });
  add({ id: 'store-escrow', sourceKey: 'recovery', sourceType: 'ground', title: ESCROW_NOTE.title, url: `${B}/ground/storage`, text: ESCROW_NOTE.body });

  // ---- credentials ----
  add({ id: 'keys-binding', sourceKey: 'credentials', sourceType: 'keys', title: 'Credentials the assistant can use and cannot read', url: `${B}/reach/keys`,
    text: `No caller ever receives a value. The only function returning plaintext returns it already attached to the outbound request, plus the list of what to scrub back out of the response — so no route, no tool and no log can ask for one. What a credential authenticates is decided by four gates in order: ${CHECKS.map((c) => `${c.label} — ${c.what}`).join(' ')}` });
  add({ id: 'keys-hosts', sourceKey: 'credentials', sourceType: 'keys', title: 'Host binding is the boundary', url: `${B}/reach/keys`,
    text: `A credential authenticates a request only if the request's host is on that credential's own owner-set list, and a wildcard covers ${KEY_FACTS.wildcardScope} — never the apex, and never a bare star, so a credential can never be host-unbound. This is what closes the exfiltration path: catalogue entries are writable by the model, so an entry pointing a known handle at an attacker's host is a perfectly well-formed record that simply fails to authenticate. Path narrowing scopes a key to particular endpoints of a host; method narrowing limits what it may do there, defaulting to ${KEY_FACTS.defaultMethods}. Worked bindings: ${CREDENTIALS.map((c) => `${c.label} — ${c.injection}, bound to ${c.hosts.join(', ')}${c.paths.length ? `, scoped to ${c.paths.join(', ')}` : ''}, ${c.methods.join('/') || 'never attached'}`).join('; ')}.` });
  add({ id: 'keys-hop', sourceKey: 'credentials', sourceType: 'keys', title: EVERY_HOP.title, url: `${B}/reach/keys`, text: EVERY_HOP.body });
  add({ id: 'keys-storeonly', sourceKey: 'credentials', sourceType: 'keys', title: STORE_ONLY.title, url: `${B}/reach/keys`, text: STORE_ONLY.body });
  add({ id: 'keys-never', sourceKey: 'credentials', sourceType: 'keys', title: 'Why a value cannot be read back', url: `${B}/reach/keys`,
    text: NEVER_READ.map((n) => `${n.k}: ${n.why}`).join(' ') });
  add({ id: 'keys-request', sourceKey: 'credential-request', sourceType: 'keys', title: NO_PARAMETER.title, url: `${B}/reach/keys`,
    text: `${NO_PARAMETER.body} The flow: ${REQUEST_FLOW.map((r) => `${r.actor} — ${r.what}`).join(' ')}` });

  // ---- the flexible store ----
  add({ id: 'store-what', sourceKey: 'datastore', sourceType: 'store', title: 'The flexible store, and its access layer', url: `${B}/memory/store`,
    text: `A typed table is right when the shape is known and stable and costs more than it is worth for the long tail. ${STORE_LESSON.body} Every call names the principal it is made for: ${ACTORS.map((a) => `${a.label} — ${a.what}`).join(' ')}` });
  add({ id: 'store-perms', sourceKey: 'datastore', sourceType: 'store', title: 'Row-level permissions and how they resolve', url: `${B}/memory/store`,
    text: `${PRECEDENCE.map((p, i) => `${i + 1}. ${p.label}: ${p.what}`).join(' ')} ${PER_ACTION.body} Wildcards: ${WILDCARDS.map((w) => `${w.k} — ${w.why}`).join(' ')} Worked records: ${STORE_RECORDS.map((r) => `${r.label} — ${r.story}`).join(' ')}` });
  add({ id: 'store-query', sourceKey: 'datastore-query', sourceType: 'store', title: 'The query language', url: `${B}/memory/store`,
    text: `${QUERY.operators.length} comparison operators (${QUERY.operators.join(', ')}) and ${QUERY.aggregates.length} aggregates (${QUERY.aggregates.join(', ')}), ${QUERY.defaultLimit} rows a page and ${QUERY.maxLimit} at most. ${QUERY_SAFETY.map((q) => `${q.k}: ${q.why}`).join(' ')}` });
  add({ id: 'store-expiry', sourceKey: 'datastore-expiry', sourceType: 'store', title: 'Expiry, limits and the ledger', url: `${B}/memory/store`,
    text: `${EXPIRY.map((e) => `${e.label}: ${e.what} Use it for ${e.use}`).join(' ')} ${REAPER.body} Per-collection ceilings: ${STORE_LIMITS.map((l) => `${l.k} — ${l.why}`).join(' ')} ${LEDGER.body} Logged actions: ${LEDGER.actions.join(', ')}.` });

  // ---- the house ----
  add({ id: 'house-tree', sourceKey: 'home', sourceType: 'house', title: TREE_NOTE.title, url: `${B}/reach/house`,
    text: `${TREE_NOTE.body} ${MULTI.body}` });
  add({ id: 'house-ops', sourceKey: 'home', sourceType: 'house', title: 'What it can do with the house', url: `${B}/reach/house`,
    text: `${HOUSE_OPS.length} operations, ${HOUSE_OPS.filter((o) => !o.writes).length} of which only read: ${HOUSE_OPS.map((o) => `${o.label} — ${o.what}`).join(' ')} The worked example on the page uses ${HOUSE_ENTITIES.length} illustrative entities; no real house is described.` });
  add({ id: 'house-dry', sourceKey: 'home', sourceType: 'house', title: DRY_RUN.title, url: `${B}/reach/house`, text: DRY_RUN.body });
  add({ id: 'house-facts', sourceKey: 'home', sourceType: 'house', title: 'Properties of the home integration', url: `${B}/reach/house`,
    text: `${HOUSE_FACTS.map((f) => `${f.k} (${f.v}): ${f.why}`).join(' ')} ${HOUSE_LESSON.body}` });

  // ---- watching for change ----
  add({ id: 'watch-alarms', sourceKey: 'watchlist', sourceType: 'watch', title: 'Nine kinds of movement a watch run notices', url: `${B}/memory/watch`,
    text: ALARMS.map((a) => `${a.label}: ${a.what} ${a.why}`).join(' ') });
  add({ id: 'watch-thresholds', sourceKey: 'watchlist', sourceType: 'watch', title: BOTH_KINDS.title, url: `${B}/memory/watch`,
    text: `${BOTH_KINDS.body} A gain must be at least ${WATCH_T.jumpRatio}× and at least ${WATCH_T.jumpMin} connections; a loss must take it below ${WATCH_T.collapseRatio}× and cost at least ${WATCH_T.collapseMin}. A new neighbour alarms only above ${WATCH_T.importantNeighbour} of top influence, confidence has to fall ${WATCH_T.confidenceDrop} before the evidence counts as weakening, and a bridge is the top ${Math.round((1 - WATCH_T.brokerPercentile) * 100)} per cent by brokerage. ${WATCH_T.snapshotNeighbours} neighbours are kept per snapshot.` });
  add({ id: 'watch-anchor', sourceKey: 'watchlist', sourceType: 'watch', title: ANCHOR.title, url: `${B}/memory/watch`,
    text: `${ANCHOR.body} ${SNAPSHOT.body}` });
  add({ id: 'watch-lens', sourceKey: 'lenses', sourceType: 'watch', title: LENS.title, url: `${B}/memory/watch`,
    text: `${LENS.body} ${LENS_RULES.map((r) => `${r.k}: ${r.why}`).join(' ')} A lens filters ${LENS_FILTERS.map((f) => `${f.k} (${f.v})`).join(', ')}. ${STANDING.body} ${WATCH_LESSON.body}` });

  // ---- the build's memory (change/lessons) ----
  add({ id: 'lessons-what', sourceKey: 'build-memory', sourceType: 'lessons', title: "The build's memory: what it is and why", url: `${B}/change/lessons`,
    text: `A second knowledge graph, separate from the entity graph: it holds what building this system has already taught it. Nodes are files and gates because those persist while chat transcripts get deleted; episodes (verified fail-fix-pass chains) and curated lessons hang off them. It was built because the builder historically took ${MEM_BASELINE.iterationsPerBuild} iterations per completed build with ${MEM_BASELINE.failingPct}% of builds failing, and each iteration spent much of its time rediscovering the codebase. Counted 17 August 2026.` });
  add({ id: 'lessons-keys', sourceKey: 'build-memory', sourceType: 'lessons', title: KEYS_NOTE.title, url: `${B}/change/lessons`, text: KEYS_NOTE.body });
  add({ id: 'lessons-evidence', sourceKey: 'build-memory', sourceType: 'lessons', title: 'The measured facts that shaped the build memory', url: `${B}/change/lessons`,
    text: MEM_EVIDENCE.map((e) => `${e.k} (${e.v}): ${e.why}`).join(' ') });
  add({ id: 'lessons-channels', sourceKey: 'build-memory', sourceType: 'lessons', title: 'How the build memory is delivered', url: `${B}/change/lessons`,
    text: `${MEM_CHANNELS.map((c) => `${c.k} (${c.v}): ${c.why}`).join(' ')} Against the alternative: a static codebase digest described 60 of 3,359 files, under two per cent, because a fixed briefing cannot know which files the next build will need. The graph answers per build, keyed to the files actually in hand.` });
  add({ id: 'lessons-corpus', sourceKey: 'build-memory', sourceType: 'lessons', title: 'What the build memory holds, and how fast it answers', url: `${B}/change/lessons`,
    text: `Counted 17 August 2026: ${MEM_CORPUS.nodes.toLocaleString('en-GB')} nodes (files and gates, ${MEM_CORPUS.nodesAtHead.toLocaleString('en-GB')} still existing — deleted files are flagged, not dropped), ${MEM_CORPUS.edges.toLocaleString('en-GB')} edges, ${MEM_CORPUS.episodes} verified episodes, ${MEM_CORPUS.lessons} lessons of which ${MEM_CORPUS.staleLessons} are flagged stale, all in ${MEM_CORPUS.dbGrowthMb} MB of database growth. Measured latency: ${MEM_LATENCY.map((l) => `${l.k} ${l.v} — ${l.why}`).join(' ')}` });
  add({ id: 'lessons-hygiene', sourceKey: 'build-memory', sourceType: 'lessons', title: 'Forgetting, staleness and honest metrics in the build memory', url: `${B}/change/lessons`,
    text: MEM_HYGIENE.map((h) => `${h.k} (${h.v}): ${h.why}`).join(' ') });
  add({ id: 'lessons-feedback', sourceKey: 'build-memory', sourceType: 'lessons', title: 'What one helpful serve is worth', url: `${B}/change/lessons`,
    text: `${MEM_FEEDBACK.note} The baseline the graph exists to beat: ${MEM_BASELINE.iterationsPerBuild} iterations per completed build (${MEM_BASELINE.last30Days} over the thirty days to 17 August 2026), with ${MEM_BASELINE.failingPct}% of builds failing. Whether it moves those numbers is not yet knowable, and the page says "too early to tell" rather than guessing.` });
  add({ id: 'lessons-anatomy', sourceKey: 'build-memory', sourceType: 'lessons', title: 'What codegraph is made of', url: `${B}/change/lessons`,
    text: `${MEM_ANATOMY.map((a) => `${a.k} (${a.v}): ${a.why}`).join(' ')} The five edge kinds: ${MEM_EDGE_KINDS.map((e) => `${e.k} — ${e.why}`).join('; ')}. ${MEM_DEDUPE.body}` });
  add({ id: 'lessons-cgql', sourceKey: 'build-memory', sourceType: 'lessons', title: 'CGQL, the codegraph query language', url: `${B}/change/lessons`,
    text: `A five-verb, non-Turing pipeline: ${MEM_CGQL.grammar.map((g) => `${g.k} (${g.v}) — ${g.why}`).join(' ')} ${MEM_CGQL.security} ${MEM_CGQL.topic}` });
  add({ id: 'lessons-fingerprint', sourceKey: 'build-memory', sourceType: 'lessons', title: 'How a gate failure becomes a retrieval fingerprint', url: `${B}/change/lessons`,
    text: `A failed check's raw output is reduced to a stable error-class fingerprint by regular expression — no model call. Three measured findings shaped it: ${MEM_FINGERPRINT.map((f) => `${f.k} (${f.v}) — ${f.why}`).join(' ')}` });
  add({ id: 'lessons-ranking', sourceKey: 'build-memory', sourceType: 'lessons', title: 'The relevance arithmetic: what deserves the prompt budget', url: `${B}/change/lessons`,
    text: `Relevance is a product of computed terms: a Wilson lower bound over a lesson's helped/didn't-help record (neutral prior ${MEM_RELEVANCE.neutralPrior} when unproven, floor ${MEM_RELEVANCE.outcomeFloor} so failure demotes rather than deletes), an age decay with half-life ${MEM_RELEVANCE.halfLifeDays} days and floor ${MEM_RELEVANCE.recencyFloor} because old is not wrong, and a stale weight of ${MEM_RELEVANCE.staleWeight}. The balance shifts with evidence: at ${MEM_RELEVANCE.evidenceHalfWeight} resolved outcomes recency and outcome carry equal weight, and the corpus-level readout refuses to claim outcome-based ranking below ${MEM_RELEVANCE.evidenceMaturity} resolved serves. Serve outcomes are resolved mechanically from the next gate run, never by a model: ${MEM_RESOLUTION.map((r) => `${r.k} → ${r.v}`).join('; ')}.` });
  add({ id: 'lessons-proof', sourceKey: 'build-memory', sourceType: 'lessons', title: 'Codegraph proven on two instrumented builds', url: `${B}/change/lessons`,
    text: MEM_PROOF.body });
  add({ id: 'lessons-surfaces', sourceKey: 'build-memory', sourceType: 'lessons', title: 'Where codegraph can be inspected', url: `${B}/change/lessons`,
    text: MEM_SURFACES.map((s) => `${s.k}: ${s.why}`).join(' ') });

  // ---- the outdoors (reach/trails) ----
  add({ id: 'trails-what', sourceKey: 'trails', sourceType: 'trails', title: 'Trails: the route planner and offline maps', url: `${B}/reach/trails`,
    text: `${PWA.body} Workouts arrive from the wearable with their GPS tracks; a router draws candidate loops over real mapped paths and the site's own scorer ranks them.` });
  add({ id: 'trails-tiles', sourceKey: 'trails', sourceType: 'trails', title: 'What an offline map costs to download', url: `${B}/reach/trails`,
    text: `Map tiles for a route are fetched at every zoom level from ${TILE.minZoom} to ${TILE.maxZoom}, padded by ${TILE.pad} whole tiles on each side, at a planning figure of ${Math.round(TILE.bytesPerTile / 1000)} KB per tile — a sample of real tiles averaged about ${TILE.measuredKb} KB, where an earlier estimate had assumed ${TILE.assumedKb}. ${PAD_STORY.body} Tiles are fetched one at a time, never as a parallel burst, because the tile service is volunteer-run and its policy asks for no bulk downloading.` });
  add({ id: 'trails-difficulty', sourceKey: 'trails', sourceType: 'trails', title: 'Grading a route by climb: equivalent kilometres', url: `${B}/reach/trails`,
    text: `${NAISMITH.body} The live bands (upper bounds of easy, moderate and hard, in equivalent km): ${Object.entries(TRAIL_BANDS).map(([s, b]) => `${SPORT_LABEL[s] ?? s} ${b.join('/')}`).join('; ')}.` });
  add({ id: 'trails-planner', sourceKey: 'trails', sourceType: 'trails', title: 'Who draws a route and who ranks it', url: `${B}/reach/trails`,
    text: TRAIL_PLANNER.map((p) => `${p.k} (${p.v}): ${p.why}`).join(' ') });
  add({ id: 'trails-guards', sourceKey: 'trails', sourceType: 'trails', title: 'The rules that keep the route planner honest', url: `${B}/reach/trails`,
    text: TRAIL_GUARDS.map((g) => `${g.k} (${g.v}): ${g.why}`).join(' ') });
  add({ id: 'trails-private', sourceKey: 'trails', sourceType: 'trails', title: WHY_PRIVATE.title, url: `${B}/reach/trails`, text: WHY_PRIVATE.body });

  return out;
}

const CHUNKS: Chunk[] = buildChunks();

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'be', 'by', 'with', 'as', 'at', 'it', 'its', 'this', 'that', 'these', 'those', 'from', 'into', 'than', 'then', 'but', 'not', 'no', 'do', 'does', 'how', 'what', 'why', 'when', 'where', 'which', 'who', 'whom', 'can', 'could', 'would', 'should', 'will', 'about', 'i', 'you', 'we', 'they', 'he', 'she', 'me', 'my', 'our', 'your']);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 2 && !STOP.has(t));
}

// Bridges between what a reader asks and what the study calls the thing.
//
// Expansion is one-directional: only a term that appears as a KEY expands. So every word a
// reader is likely to type needs its own entry, not just the word the study happens to use.
// Live-testing the deployed dock is what surfaced this — "where does the money go" expanded
// to nothing, because `money` was only ever a value under `cost`. The concept groups below
// are therefore written out per-term rather than once per concept.
const GROUPS: string[][] = [
  // The tour's vocabulary. A reader who has just looked at the pictures asks "what is
  // that screen", not "describe the surface", so both have to reach the same chunks.
  ['page', 'pages', 'screen', 'screens', 'surface', 'surfaces', 'view', 'views', 'section', 'tour'],
  ['screenshot', 'screenshots', 'picture', 'pictures', 'image', 'images', 'photo', 'shot', 'look', 'looks'],
  ['redact', 'redacted', 'redaction', 'anonymise', 'anonymised', 'obscured', 'blurred', 'placeholder', 'standin', 'invented'],
  ['login', 'private', 'public', 'owner', 'gated', 'password', 'anonymous', 'visitor'],
  ['cost', 'costs', 'price', 'pricing', 'money', 'spend', 'spending', 'bill', 'billed', 'cheap', 'cheaper', 'expensive', 'afford', 'budget', 'token', 'tokens'],
  ['cache', 'caching', 'cached', 'prefix', 'breakpoint', 'reuse', 'discount'],
  ['slow', 'fast', 'speed', 'latency', 'ttft', 'wait', 'waiting', 'delay', 'quick', 'performance'],
  ['model', 'models', 'llm', 'ai', 'gateway', 'openrouter', 'provider', 'seller', 'brain', 'choose', 'choosing', 'selection', 'routing', 'route'],
  ['security', 'secure', 'safety', 'safe', 'guardrail', 'guardrails', 'boundary', 'protect', 'protection', 'risk', 'dangerous', 'attack', 'abuse'],
  ['secret', 'secrets', 'credential', 'credentials', 'key', 'keys', 'password', 'vault', 'registry', 'auth', 'permission', 'permissions', 'access'],
  ['memory', 'remember', 'remembers', 'storage', 'store', 'database', 'postgres', 'recall', 'knows', 'know'],
  ['search', 'retrieval', 'retrieve', 'rag', 'embedding', 'embeddings', 'vector', 'index', 'lookup', 'find', 'finds', 'semantic'],
  ['graph', 'entity', 'entities', 'relationship', 'relationships', 'connection', 'connections', 'network', 'intel'],
  ['merge', 'merges', 'duplicate', 'duplicates', 'resolution', 'match', 'matching', 'dedupe', 'same', 'person', 'people'],
  ['deploy', 'deploys', 'deployment', 'ship', 'shipping', 'production', 'release', 'live', 'pipeline', 'ci', 'gate', 'merge', 'git'],
  ['workflow', 'workflows', 'automation', 'automate', 'canvas', 'node', 'nodes', 'cron', 'schedule', 'scheduled', 'trigger'],
  ['tool', 'tools', 'toolkit', 'manifest', 'function', 'capability', 'capabilities', 'mcp', 'protocol'],
  ['build', 'builder', 'builds', 'sandbox', 'container', 'publish', 'app', 'application', 'code', 'writes'],
  ['improve', 'improvement', 'nightly', 'overnight', 'night', 'autonomous', 'autonomy', 'itself', 'repair', 'self'],
  ['chat', 'conversation', 'assistant', 'turn', 'message', 'reply', 'stream', 'streaming', 'hermes', 'agent'],
  ['bug', 'bugs', 'failure', 'failures', 'incident', 'broke', 'broken', 'wrong', 'mistake', 'mistakes', 'hazard', 'scar', 'fail', 'failed'],
  ['fabricate', 'fabrication', 'hallucinate', 'hallucination', 'invent', 'invented', 'provenance', 'source', 'sources', 'citation', 'cite', 'trust'],
  ['prompt', 'prompts', 'context', 'instruction', 'instructions', 'prefill', 'window'],
  ['reasoning', 'thinking', 'thinks', 'think', 'empty', 'truncated', 'cut'],
  ['research', 'researching', 'facts', 'fact', 'gaps', 'gap', 'desk', 'report'],
  ['size', 'big', 'large', 'scale', 'how many', 'count', 'lines', 'number'],
  ['why', 'reason', 'because', 'decision', 'chose', 'trade', 'tradeoff'],
  // Added with the channels/trust/drive/decks/feeds/ground pages. Same rule as above: every
  // word a reader is likely to type needs its own entry, because expansion is per-term.
  ['channel', 'channels', 'ingest', 'ingestion', 'feeds', 'feed', 'inbound', 'arrives', 'arrive', 'door', 'doors'],
  ['mail', 'email', 'emails', 'inbox', 'mailbox', 'thread', 'threads', 'gmail', 'correspondence', 'correspondent'],
  ['whatsapp', 'phone', 'mobile', 'message', 'messaging', 'capture', 'note', 'notes', 'dictate'],
  ['trust', 'trusted', 'believe', 'belief', 'confidence', 'confident', 'credible', 'credibility', 'reliability', 'reliable', 'grade', 'graded', 'grading', 'admiralty', 'ratify', 'ratified', 'verify', 'verified', 'unverified', 'corroboration', 'corroborated', 'score', 'scoring'],
  ['stale', 'staleness', 'decay', 'decays', 'age', 'ageing', 'aging', 'old', 'older', 'recent', 'recency', 'freshness', 'fresh', 'halflife'],
  ['drive', 'file', 'files', 'document', 'documents', 'upload', 'uploads', 'folder', 'folders', 'attachment', 'attachments', 'webdav', 'store'],
  ['photo', 'photograph', 'image', 'images', 'picture', 'pictures', 'audio', 'voice', 'transcript', 'transcription', 'caption', 'ocr', 'multimodal', 'modality', 'video'],
  ['deck', 'decks', 'slide', 'slides', 'presentation', 'presentations', 'talk', 'layout', 'layouts', 'block', 'blocks', 'compose', 'composer'],
  ['share', 'shared', 'sharing', 'link', 'links', 'token', 'tokens', 'public', 'private', 'revoke', 'expire'],
  ['health', 'fitness', 'body', 'wearable', 'strap', 'watch', 'sleep', 'strain', 'recovery', 'steps', 'heart', 'hrv', 'biometric', 'biometrics'],
  ['connector', 'connectors', 'integration', 'integrations', 'probe', 'probes', 'status', 'stale', 'broken', 'connected', 'disconnected'],
  ['unit', 'units', 'scaling', 'scaled', 'hundredths', 'rounding', 'conversion', 'metric', 'metrics', 'measurement', 'measurements'],
  ['api', 'apis', 'catalogue', 'catalog', 'register', 'registry', 'endpoint', 'endpoints', 'external', 'outside', 'call', 'calls'],
  ['host', 'hosts', 'hosting', 'machine', 'machines', 'server', 'servers', 'infrastructure', 'estate', 'topology', 'architecture', 'runs', 'running', 'origin', 'vps', 'home', 'cloud', 'datacentre', 'datacenter'],
  ['storage', 'stored', 'bytes', 'disk', 'blob', 'bucket', 'object', 'azure', 'filesystem', 'volume'],
  ['backup', 'backups', 'restore', 'recovery', 'recover', 'snapshot', 'snapshots', 'escrow', 'disaster', 'lost', 'lose', 'losing', 'offsite'],
  ['tunnel', 'edge', 'network', 'mesh', 'private', 'port', 'ports', 'firewall', 'exposed', 'inbound', 'outbound'],
  ['scraper', 'scraping', 'scrape', 'browser', 'stealth', 'residential'],
  ['binding', 'bound', 'allowlist', 'allowed', 'scope', 'scoped', 'narrow', 'narrowing', 'host', 'hosts', 'wildcard', 'redirect', 'hop'],
  ['datastore', 'collection', 'collections', 'record', 'records', 'row', 'rows', 'jsonb', 'schemaless', 'flexible'],
  ['actor', 'actors', 'principal', 'who', 'owner', 'audit', 'ledger', 'attributable', 'expiry', 'expire', 'ttl', 'lifetime'],
  ['house', 'home', 'lights', 'light', 'heating', 'thermostat', 'sensor', 'sensors', 'room', 'rooms', 'area', 'areas', 'entity', 'entities', 'automation', 'dryrun'],
  ['watchlist', 'watch', 'watched', 'alarm', 'alarms', 'alert', 'alerts', 'changed', 'change', 'moved', 'diff', 'snapshot', 'threshold', 'thresholds', 'insight', 'insights'],
  ['lens', 'lenses', 'view', 'views', 'perspective', 'saved', 'filter', 'filters', 'professional', 'personal'],
  ['broker', 'bridge', 'centrality', 'cluster', 'community', 'louvain', 'degree', 'neighbour', 'neighbours', 'influence'],
  // Added with the build's-memory and trails pages. Same rule: every word a reader might
  // type gets its own entry, because expansion is per-term.
  ['lesson', 'lessons', 'episode', 'episodes', 'codegraph', 'history', 'learned', 'learning', 'learns', 'remembered', 'fingerprint', 'iteration', 'iterations', 'rediscovery', 'digest', 'briefing', 'recall', 'forgetting', 'forget', 'retire', 'retired', 'tombstone'],
  ['cgql', 'query', 'queries', 'grammar', 'seed', 'hops', 'verdict', 'wilson', 'ranking', 'ranked', 'relevance', 'atrophy', 'demoted', 'served', 'serve', 'serves', 'helpful', 'unhelpful', 'unresolved', 'dedupe', 'backfill', 'stale'],
  ['trail', 'trails', 'route', 'routes', 'map', 'maps', 'offline', 'tile', 'tiles', 'gps', 'hike', 'hiking', 'walk', 'walking', 'running', 'ride', 'riding', 'cycling', 'outdoors', 'outdoor', 'signal', 'download', 'downloaded', 'downloads', 'naismith', 'climb', 'ascent', 'elevation', 'difficulty', 'planner', 'loop', 'loops', 'pwa', 'installed', 'app'],
];

// Every term in a group expands to every other term in that group.
const SYNONYMS: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const g of GROUPS) {
    for (const term of g) {
      const others = g.filter((t) => t !== term);
      out[term] = out[term] ? [...new Set([...out[term], ...others])] : others;
    }
  }
  return out;
})();

const K1 = 1.5, BB = 0.75;
const docTokens: string[][] = CHUNKS.map((c) => tokenize(`${c.title} ${c.text}`));
const titleTokenSets: Set<string>[] = CHUNKS.map((c) => new Set(tokenize(c.title)));
const docLen = docTokens.map((t) => t.length);
const avgdl = docLen.reduce((s, l) => s + l, 0) / Math.max(1, docLen.length);
const df = new Map<string, number>();
const postings = new Map<string, Array<[number, number]>>();
docTokens.forEach((toks, d) => {
  const tf = new Map<string, number>();
  for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
  for (const [t, f] of tf) {
    df.set(t, (df.get(t) ?? 0) + 1);
    if (!postings.has(t)) postings.set(t, []);
    postings.get(t)!.push([d, f]);
  }
});
const N = CHUNKS.length;
const idf = (t: string) => Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));

function expand(tokens: string[]): Map<string, number> {
  const bag = new Map<string, number>();
  for (const t of tokens) bag.set(t, Math.max(bag.get(t) ?? 0, 1));
  for (const t of tokens) {
    const syns = SYNONYMS[t];
    if (syns) for (const phrase of syns) for (const st of tokenize(phrase)) bag.set(st, Math.max(bag.get(st) ?? 0, 0.5));
  }
  return bag;
}

/** Top-k corpus chunks for a query (BM25 + synonyms + title boost + per-source diversity cap). */
export function retrieve(query: string, k = 10): Retrieved[] {
  const bag = expand(tokenize(query));
  if (bag.size === 0) return [];
  const scores = new Map<number, number>();
  for (const [term, w] of bag) {
    const plist = postings.get(term);
    if (!plist) continue;
    const termIdf = idf(term);
    for (const [d, f] of plist) {
      const denom = f + K1 * (1 - BB + (BB * docLen[d]) / avgdl);
      let s = w * termIdf * ((f * (K1 + 1)) / denom);
      if (titleTokenSets[d].has(term)) s *= 1.6;
      scores.set(d, (scores.get(d) ?? 0) + s);
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const perSource = new Map<string, number>();
  const out: Retrieved[] = [];
  for (const [d, score] of ranked) {
    const c = CHUNKS[d];
    const n = perSource.get(c.sourceKey) ?? 0;
    if (n >= 3) continue;
    perSource.set(c.sourceKey, n + 1);
    out.push({ ...c, score });
    if (out.length >= k) break;
  }
  return out;
}

/** Corpus size, quoted on the page — a study about measuring things should measure itself. */
export const CORPUS_SIZE = CHUNKS.length;
