// src/lib/daydream/mechanics.ts
//
// What each activity actually DOES — reads, writes, gates, model — as data,
// so the Engine room can open any instrument and show the mechanism behind
// it rather than a name and an outcome word. PURE; the live telemetry
// (config, pulses, spend) is joined on by `rooms/engine.server.ts`.
//
// Written from the code, not from the descriptions: `description` on each
// handler says what it is FOR; this says how it works and what it touches.
// When an activity changes, this is the second place to edit.

import { SPENDING_ACTIONS } from './budget';

export interface Mechanics {
  /** The stage of the loop the Engine room files it under. */
  stage: 'observe' | 'discover' | 'test' | 'propose' | 'improve';
  /** One paragraph, plain English: the mechanism. */
  how: string;
  /** Tables, services and APIs it reads. */
  reads: string[];
  /** Tables it writes, and to whom it may speak. */
  writes: string[];
  /** What must be true before it does anything. */
  gates: string[];
  /** The model it calls, or null when it is rules only. */
  model: string | null;
  /** Which resolved effort values reach it (`effort.ts`). */
  effort: string[];
  /** Heartbeat-row config keys and what each means. */
  config: Record<string, string>;
}

const ENABLED = 'daydreaming enabled (`daydream.enabled`)';
const IDLE = 'owner idle for `idleWindowMinutes` (spare cycles only)';
const BUDGET = 'under the Codex caps (10% of weekly a day, 50% of the 5-hour window), paced against waking hours';
const CODEX = 'codex/gpt-5.6-terra (`jkai.daydream.model`)';

export const MECHANICS: Readonly<Record<string, Mechanics>> = {
  observe: {
    stage: 'observe',
    how: 'Every two minutes it asks Home Assistant for every family member’s tracker in one `/api/states` call and writes a fix per person to the trail — lat/lon, whether home, distance from home, battery. Standing still writes nothing on the push path, so this poll floor is what makes stillness distinguishable from a dead sensor: a failed poll writes a `gap` row with the reason, and `coverageOf()` turns fixes into a real fraction. A failed poll is deliberately not an error outcome, or it would burn the failure budget and pause the one thing recording.',
    reads: ['Home Assistant `/api/states` (device_tracker source attributes)'],
    writes: ['daydream_trail (fixes and gap rows, one row per person)'],
    gates: [ENABLED],
    model: null,
    effort: [],
    config: { personEntity: 'the HA person entity for the owner', pushFreshMins: 'how recent a push fix must be before the poll stands down' },
  },
  places: {
    stage: 'observe',
    how: 'Reclusters the trail into places: a stay of ten minutes still makes a place, three separate local days make it a question. Visits are time spent still per person, not the span between first and last fix — half the table was road before that rule. Clusters the trail merely passes through are set aside as `transit`; places keep household aggregates while per-person rhythms come from the trail itself.',
    reads: ['daydream_trail'],
    writes: ['daydream_places (visit_count, distinct_days, dwell, histograms, status)'],
    gates: [ENABLED],
    model: null,
    effort: [],
    config: { prune: 'retire clusters that no longer meet the floor', windowDays: 'how far back to recluster', retentionDays: 'trail rows older than this are dropped' },
  },
  signals: {
    stage: 'observe',
    how: 'The open registry. Discovers every Home Assistant entity state and numeric attribute, mirrors the feature store as `feature:*`, builds journey signals between named places, fetches per-person weather at their median position, publishes the graph’s daily rates, samples every self-built tool that takes no arguments (once a day), and — since September — research and timeline rates, segment form, and the health hub’s derived layer. Nothing names a series by hand; a source joins by calling `registerSignals()`. Then the fault ledger: silent sources and source errors are raised, and any metric fault a new tool signal answers is closed.',
    reads: ['Home Assistant states', 'daydream_day_features', 'daydream_trail + daydream_places', 'Open-Meteo', 'intel_* rates', 'custom_tools (no-arg ones)', 'research_session / fact / narrative_item / intel_timeline_events', 'activity segments', '$lib/health services'],
    writes: ['daydream_signals (registry)', 'daydream_observations (day × subject × key)', 'daydream_faults'],
    gates: [ENABLED, 'tool sampling, segments and health once a day'],
    model: null,
    effort: [],
    config: { harvestHa: 'read Home Assistant', harvestTools: 'sample self-built tools', mirrorWindowDays: 'feature-store days mirrored', journeyWindowDays: 'days of trail turned into journeys', weatherDays: 'trailing days of weather refetched', graphWindowDays: 'graph rates recomputed', researchDays: 'research and timeline rates recomputed', harvestSegments: 'sample segment form', harvestHealth: 'sample the health derived layer' },
  },
  features: {
    stage: 'observe',
    how: 'Builds one row per local day per person: sleep, recovery, strain, steps, workouts, minutes out, places visited, calendar busy minutes, verified spend. Five time formats and two scaling conventions go in; every column is nullable because absent is not zero. Health, spend and the calendar are owner-only by policy; a family member’s row carries trail facts only.',
    reads: ['whoop_* and apple health metrics', 'daydream_trail', 'calendar (through `calendar/read.ts`, exclusions applied)', 'daydream_spend'],
    writes: ['daydream_day_features'],
    gates: [ENABLED],
    model: null,
    effort: [],
    config: { windowDays: 'days rebuilt each pass' },
  },
  bank: {
    stage: 'observe',
    how: 'Nightly, in a fixed window: pulls debits from TrueLayer and PayPal into the spend table, deduped on the source id, verified at birth. Off until `daydream.bank.enabled` is set; fails loud on a dead token because the TrueLayer refresh token rotates on every exchange and a job that does not own that lifecycle silently stops.',
    reads: ['TrueLayer transactions', 'PayPal transactions'],
    writes: ['daydream_spend (source `truelayer:` / `paypal:`)'],
    gates: [ENABLED, '`daydream.bank.enabled`', 'active-hours window 05:00–07:00'],
    model: null,
    effort: [],
    config: { windowDays: 'days of transactions pulled' },
  },
  spend: {
    stage: 'observe',
    how: 'Reads receipts out of email: a free filter over intel notes shortlists mails that carry an amount, and a model extracts merchant, amount and date from the shortlist only. 605 mails carry an amount and 34 are receipts — the rest advertise prices — so the filter is the work and the model is the last step.',
    reads: ['intel_notes (email)'],
    writes: ['daydream_spend (source `receipt`)'],
    gates: [ENABLED, BUDGET],
    model: CODEX,
    effort: [],
    config: { limit: 'receipts extracted a pass', sinceDays: 'how far back to look' },
  },
  offers: {
    stage: 'observe',
    how: 'Indexes vouchers and offers out of bulk email: a weighted subject-line filter shortlists, then a model extracts the merchant, the offer and its expiry. Offers are what `near_offer` matches against a place you are at.',
    reads: ['intel_notes (bulk email)'],
    writes: ['daydream_offers'],
    gates: [ENABLED, BUDGET, 'active hours 07:00–23:00'],
    model: CODEX,
    effort: [],
    config: { maxPerRun: 'offers extracted a pass' },
  },
  mail: {
    stage: 'observe',
    how: 'Reads the half of the mailbox nothing else reads — correspondence and notifications — with rules, not a model: four lanes (security, money admin, official, unusual) scored over subject and sender, calibrated against the whole production corpus. Bursts of three mails from two senders in 48 hours become one thought; a scan reads a fortnight and speaks about the last four days. Security may push; the other lanes are feed-only by route.',
    reads: ['intel_notes (correspondence + notifications)'],
    writes: ['daydream_thoughts (kind mail_*)'],
    gates: [ENABLED, 'active hours 07:00–23:00'],
    model: null,
    effort: [],
    config: { maxPerRun: 'thoughts raised a pass', windowDays: 'days of mail read' },
  },
  notebook: {
    stage: 'observe',
    how: 'Reads the notes you write on idle cycles: a token-capped model plans short research (`scan` or `brief` only — an `investigation` detaches for twenty minutes and is refused), graph links and supporting text over a closed vocabulary. Its output goes to `supporting`, never to your text; planned and executed are stamped separately. Notes tagged `steer` are also what the hypothesis proposer reads as your priorities.',
    reads: ['daydream_notebook', 'intel_entities (for links)'],
    writes: ['daydream_notebook.supporting', 'daydream_notebook_actions', 'research sessions (scan / brief)', 'intel notes (weave)'],
    gates: [ENABLED, IDLE, 'active hours 07:00–23:00'],
    model: CODEX,
    effort: [],
    config: { notesPerRun: 'notes reviewed a pass', idleWindowMinutes: 'how idle you must be' },
  },
  memory: {
    stage: 'observe',
    how: 'Nightly consolidation of daydream’s own memories — reviewer rulings, your notes on thoughts, named places — into reusable themes (lessons and values) with source edges, so the ponder pack carries a few themes instead of every raw sentence. Memories from chat or elsewhere are outside its scope by origin.',
    reads: ['jkai_memories (daydream origin only)'],
    writes: ['daydream_memory_themes', 'daydream_memory_theme_sources', 'daydream_memory_consolidations', 'jkai_memories.consolidated_at'],
    gates: [ENABLED, 'window 22:30–23:30 Europe/London'],
    model: CODEX,
    effort: [],
    config: {},
  },
  sweep: {
    stage: 'discover',
    how: 'Once a day, for each person: takes every signal with enough observed days, drops constants and near-duplicates, correlates every pair same-day and one-day-lagged with Spearman, and applies Benjamini–Hochberg within the subject. Reports the uncorrected count beside the corrected one so a quiet day reads as quiet rather than broken. Survivors are persisted to the findings table and carded into pondering; the hypothesis proposer is deliberately never shown them.',
    reads: ['daydream_signals', 'daydream_observations'],
    writes: ['daydream_sweep_findings', 'pulse details (per-subject summary)'],
    gates: [ENABLED, 'a signal needs `MIN_PAIRS` observed days'],
    model: null,
    effort: ['sweep.maxSignals (discover share)'],
    config: { fdr: 'false-discovery rate for the correction', windowDays: 'days of observations swept' },
  },
  hypothesise: {
    stage: 'discover',
    how: 'Pre-registration. A model is shown the menu — every day-feature column and every sweepable signal, each with its day count — plus what was already asked, the open lines of enquiry and your steer notes, and it proposes questions as data. It is NOT shown any correlation; that is what makes q meaningful over a handful of tests instead of hundreds. Code validates each proposal against the allow-list (a spelling is repaired, a guess about meaning refused), then tests it against the day series with the same correction. An unknown metric is a fault the toolsmith reads.',
    reads: ['daydream_day_features', 'daydream_observations (for signal keys)', 'daydream_hypotheses', 'daydream_leads (open)', 'notebook steer notes'],
    writes: ['daydream_hypotheses (proposed, then verdicts)', 'daydream_faults (metric_unknown)'],
    gates: [ENABLED, BUDGET],
    model: CODEX,
    effort: ['hypothesise.maxProposals (discover share)'],
    config: { maxProposals: 'questions proposed per person per night', windowDays: 'days of series tested against' },
  },
  explore: {
    stage: 'discover',
    how: 'Advances the frontier of open lines of enquiry while you are idle: each lead is rescored from its own results (arithmetic, no model), only the top few get a round, a round is judged only once the question-asker has run since it began, and a lead abandoned after its barren rounds writes a trace and a fault. Every step is a reviewable row in the lead-steps table.',
    reads: ['daydream_leads', 'daydream_hypotheses', 'daydream_lead_steps'],
    writes: ['daydream_leads (status, rounds)', 'daydream_lead_steps', 'daydream_faults (lead_barren)'],
    gates: [ENABLED, IDLE],
    model: null,
    effort: ['explore.maxLeads (discover share)'],
    config: { maxLeads: 'leads advanced a round', idleWindowMinutes: 'how idle you must be' },
  },
  ponder: {
    stage: 'discover',
    how: 'The pondering half of the second brain. Code assembles a carded fact pack — present, upcoming, past: family, diary, money, health, email facts, graph, memory themes, recent findings, new sources, notes — and may run a few read-only lookups it chooses itself; the model returns musings, leads and standing-action rules as data; a cite-or-die audit drops any musing citing a card it was not given (the drop count is the fabrication meter). Musings become ordinary thoughts and go through the same threshold, review and delivery as everything else.',
    reads: ['the snapshot (trail, places, calendar, health, email facts, spend, family)', 'daydream_memory_themes', 'daydream_sweep_findings', 'daydream_signals', 'daydream_notebook', 'reviewer rulings', 'read-only lookup tools (allow-listed)'],
    writes: ['daydream_thoughts (kind musing_*)', 'daydream_leads', 'daydream_rules (proposed actions)', 'daydream_faults (metric_unknown, audit_drop)'],
    gates: [ENABLED, IDLE, BUDGET, 'active hours 07:00–23:00'],
    model: CODEX,
    effort: ['ponder.maxMusings, ponder.maxLeads, ponder.lookupBudget (discover share)', 'verify pass (test share)'],
    config: { idleWindowMinutes: 'how idle you must be' },
  },
  intel: {
    stage: 'discover',
    how: 'Bridges the knowledge graph’s own rule-based findings into thoughts (kind `intel_<kind>`) above a bar, recomputing the insights itself because nothing else generates them on a schedule. Since September the return legs run every pass too: a verified graph link is applied (woven, insight actioned, thought archived as `applied`), and an insight you dismissed or actioned on the intel page takes its thought with it.',
    reads: ['intel_insights', 'intel_entities / relationships (for generation)'],
    writes: ['daydream_thoughts (kind intel_*)', 'intel_insights.status', 'intel notes (weave)'],
    gates: [ENABLED],
    model: null,
    effort: [],
    config: { freshDays: 'how old an insight may be to bridge' },
  },
  review: {
    stage: 'test',
    how: 'Nothing interrupts you until a model has checked it against the sources. Every live thought without a verdict is handed its evidence with the row ids, and the reviewer reads the actual rows (it may read mail — the one stage allowed to read text other people wrote, survivable because its blast radius is one verdict). Verified lifts the threshold and nothing else; refuted is silent, not deleted, and remembered so the claim is not made again; an uncertain that could not reach its rows is a `needs_source` fault, not a verdict.',
    reads: ['daydream_thoughts (unreviewed)', 'the evidence rows behind each (mail, spend, places, trail, graph)'],
    writes: ['daydream_thoughts.review_* and status', 'jkai_memories (rulings)', 'daydream_faults (needs_source)'],
    gates: [ENABLED, IDLE, BUDGET, 'no builds in flight'],
    model: 'codex/gpt-5.6-luna at xhigh (pinned)',
    effort: ['review.maxPerRun, review.backfillPerRun (test share)'],
    config: { maxPerRun: 'thoughts reviewed a pass', backfillPerRun: 'old rulings written to memory a pass', idleWindowMinutes: 'how idle you must be' },
  },
  rulesmith: {
    stage: 'test',
    how: 'Daily, before dawn: a model proposes new detector rules, tweaks and deprecations as DATA — a closed expression tree over an allow-list of 24 scalar facts, walked by an interpreter, never code. Three gates in cost order: validate (free), backtest over stored history (a query; auto-refuses anything over 14 fires a week), then you. Nothing activates on its own; a rule buzzes a phone.',
    reads: ['daydream_rules and their outcomes', 'the ledger of what fired'],
    writes: ['daydream_rules (proposed)'],
    gates: [ENABLED, BUDGET, 'window 04:00–06:00', 'stops at `maxPending` awaiting you'],
    model: CODEX,
    effort: [],
    config: { maxPending: 'proposals it will leave waiting', maxProposals: 'proposals a night' },
  },
  detect: {
    stage: 'propose',
    how: 'Every ten minutes: builds the snapshot, runs every hand-written detector and every approved rule over it, and persists the candidates — the same row is updated by its dedupe key, a mute is absolute, a claim already refuted or already live is folded rather than added, and the cold-start threshold and kind weight decide `new` versus held. Also wakes snoozed thoughts and files verified, unrated ones after a week.',
    reads: ['the snapshot', 'daydream_rules (active)', 'feedback and relevance rows', 'reviewer refutations', 'live thoughts'],
    writes: ['daydream_thoughts'],
    gates: [ENABLED],
    model: null,
    effort: [],
    config: { disabledKinds: 'detectors switched off by kind' },
  },
  compose: {
    stage: 'propose',
    how: 'Takes the best undelivered thoughts and decides, per thought: route (whatsapp, briefing, feed), then verified, then score against the adaptive bar, then your kind weight, then quiet hours, a cooldown that shortens for kinds you rate up, the daily cap and the minimum gap. Anything verified that fails the policy is held for the morning briefing. A pre-narrated musing is sent as it is; a detector thought is phrased by a model and, at higher depth, verified against its evidence before sending.',
    reads: ['daydream_thoughts (undelivered)', 'routes and effort settings', 'relevance and feedback rows', 'delivery state (what went out today)'],
    writes: ['daydream_thoughts (channel, delivered_at, held reason)', 'WhatsApp / push / chat'],
    gates: [ENABLED, IDLE, BUDGET, 'active hours 08:00–21:00'],
    model: CODEX,
    effort: ['compose.extraCandidates (propose share)', 'verify (test share)'],
    config: { idleWindowMinutes: 'how idle you must be' },
  },
  suggest: {
    stage: 'propose',
    how: 'Reverse-geocodes unnamed places through Nominatim so the naming form opens pre-filled — one lookup a second by their policy, thirty a pass, quiet once the queue drains. The guess lands in `suggested_*`, never in `label`: seven detectors gate on a label meaning you said so.',
    reads: ['daydream_places (unnamed)', 'Nominatim'],
    writes: ['daydream_places.suggested_label / suggested_address'],
    gates: [ENABLED],
    model: null,
    effort: [],
    config: { limit: 'places looked up a pass' },
  },
  digest: {
    stage: 'propose',
    how: 'Every six hours recomputes yesterday’s digest row — questions asked and answered, held, refuted, thoughts raised and said, places named — deterministically from counts. It notifies nobody; the morning briefing reads it as one input of its Daydreams section.',
    reads: ['daydream_hypotheses', 'daydream_thoughts', 'daydream_places'],
    writes: ['daydream_digests (subject john)'],
    gates: [ENABLED],
    model: null,
    effort: [],
    config: {},
  },
  weekly: {
    stage: 'propose',
    how: 'The Sunday letter: deterministic counts for the week always; a model narrative written from those counts only, verified at temperature zero and dropped whole if unsupported. Quotes what the reviewer caught. Sent by WhatsApp outside the daily interruption cap, as correspondence.',
    reads: ['the week of pulses, thoughts, verdicts and leads'],
    writes: ['daydream_digests (subject weekly)', 'WhatsApp'],
    gates: [ENABLED, BUDGET, 'Sundays, window 17:00–21:00'],
    model: CODEX,
    effort: [],
    config: {},
  },
  appetite: {
    stage: 'discover',
    how: 'Once a day, in the evening, it assembles an evidence pack — the types of question the owner has been asking and whether they were served well, an inventory of every signal source, catalogued API, toolset, watch, news feed and enabled schedule the site can already reach, the open faults where daydreaming came up short, and every capability already on the ledger — then asks the model what the site should be able to do and cannot. Each proposal must cite pack keys verbatim; one that cites nothing in the pack is dropped by name on the pulse. Code scores what survives over named inputs (citations, how much new data the lane brings in, and how many separate nights the idea has been arrived at), writes it to the appetite ledger, and offers the strongest as ordinary thoughts routed to the briefing. It cannot build anything.',
    reads: ['orchestrator chats (14d)', 'question_insights', 'daydream_signals by source', 'api_catalog', 'site-tool toolsets', 'monitors', 'workflow_schedules', 'daydream_faults', 'daydream_hypotheses (starvation)', 'daydream_capabilities'],
    writes: ['daydream_capabilities', 'daydream_thoughts (capability_* candidates)'],
    gates: [ENABLED, IDLE, 'once a day', 'window 20:00–23:30 Europe/London', BUDGET],
    model: CODEX,
    effort: ['discover → how many capabilities one scan may admit'],
    config: { idleWindowMinutes: 'how recently the owner must have been quiet', maxLeads: 'proposals per scan; 0 means take it from the effort dial' },
  },
  improve: {
    stage: 'improve',
    how: 'The self-improvement engine, one activity with eight phases in a 25-minute nightly slot: gather (a week of chats, tool audit), learn (the appetite ledger FIRST, then the daydream fault ledger, then starvation and health faults, the engine’s own proposals, and question-mined needs), discover (search the catalogue then the web for a source each need names, register it with a live probe), build (author runtime tools — half the slots held for `source` items whenever any is open), repair, propose (hand a repo change to the autonomous builder as a change request, and a watch to the monitor generator; a draft PR only where there is no build lane), optimise, report. A tool it ships that takes no arguments is sampled the next day as a signal — the return edge. Reordered 2026-09-04: propose now runs before optimise, and optimise measures and judges but may not start a NEW call-efficiency experiment while new-data work is open.',
    reads: ['orchestrator chats', 'custom_tools health', 'improvement_backlog', 'daydream_capabilities', 'daydream_faults', 'daydream_hypotheses (starvation)', 'api_catalog'],
    writes: ['improvement_backlog', 'custom_tools (live)', 'api_catalog', 'improvement_runs', 'daydream_capabilities (what each lead became)', 'GitHub issues + repo builds', 'scheduled monitors', 'draft PRs', 'WhatsApp report'],
    gates: ['`selfimprove.enabled`', 'production host only', 'window 02:30–03:55 Europe/London', '40 LLM calls / ~$0.50 / 25 min', 'a repo build or a watch needs the owner to have accepted the lead, unless `daydream.appetite.autobuild` is explicitly true — then one of each a night'],
    model: 'The `jkai.selfimprove.model` setting (falls back to SELFIMPROVE_MODEL) — pinned apart from the chat default so an unattended run does not move when the picker does. The ledger line below says what it actually ran on and whether that was cash or quota.',
    effort: [],
    config: { allowDevHost: 'let it run on homeserv' },
  },
};

export function mechanicsFor(name: string): Mechanics | null {
  return MECHANICS[name.replace(/^daydream-/, '')] ?? null;
}

export function spendsQuota(name: string): boolean {
  return (SPENDING_ACTIONS as readonly string[]).includes(name);
}
