// retrieval.server.ts — SERVER-ONLY lexical retrieval for this study's Ask dock.
//
// BM25 with synonym expansion, a title boost and a per-source diversity cap, over passages
// assembled at module load from the SAME sources the pages render: the facts read from the
// feature code, the explainer copy keyed by the feature's types, and the app manifest. So
// the dock can't answer from a version of the study the pages no longer show.
//
// A vector index would be the fashionable choice and the wrong one: the corpus is a few
// dozen short passages in one voice, and a lexical ranker with a synonym table is faster
// and more predictable at that size.

import { loadFacts } from './facts.server';
import { PARTS, href, B } from './nav';
import { DAYDREAM_COPY, STAGE_ENG, COMMISSION_COPY } from './daydream';
import {
  BUILD_COPY, DELIVERY_COPY, POLICY_COPY, BRIEF_LANE_COPY, VERIFY_COPY, GATE_COPY, PHASE_COPY,
  SOURCE_COPY, EDGE_COPY, ACTIVITY_COPY, LANE_COPY,
} from './build';
import {
  APP, APP_COPY, TAB_COPY, MORE_COPY, WATCH_COPY, SURFACE_COPY, BACKGROUND_COPY,
  PERMISSION_COPY, ENTITLEMENT_COPY, AREA_COPY,
} from './app';

export type SourceType = 'overview' | 'daydream' | 'build' | 'app';

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

type Twin = { plain: string; eng: string };
const both = (t: Twin) => `${t.plain} ${t.eng}`;
const list = (xs: string[]) => xs.join(', ');

function buildChunks(): Chunk[] {
  const f = loadFacts();
  const d = f.daydream, b = f.build, a = f.app;
  const out: Chunk[] = [];
  const add = (sourceType: SourceType, sourceKey: string, title: string, url: string | null, text: string) =>
    out.push({ id: `${sourceKey}#${out.length}`, sourceKey, sourceType, title, url, text });

  // Overview
  add('overview', 'index', 'The Engine Room', B,
    `The study covers three features of strangeramblings.com: ${list(PARTS.map((p) => `${p.name} (${p.strap})`))}. ` +
    'Everything else on the site is ordinary engineering and is not covered.');
  add('overview', 'index', 'How this study keeps up with the features', B,
    'Nothing on these pages is copied by hand. Stage names, caps and schedules are imported from the code that runs each feature and change on the next deploy. ' +
    'Explainer text is keyed by the feature\'s own types, so a new stage without a sentence fails the type check, and a drift test pins the rest. ' +
    'Live numbers are totals read from the database every few minutes. The app\'s make-up is a manifest generated from the app\'s own Swift source.');
  for (const p of PARTS) add('overview', p.id, p.name, href(p.id), `${p.strap}. ${p.lede} Pages: ${list(p.leaves.map((l) => `${l.label} — ${l.blurb}`))}.`);

  // Daydream
  const Q = href('daydream', 'questions'), I = href('daydream', 'inbox'), M = href('daydream', 'impact');
  add('daydream', 'questions', 'How daydream picks what to think about', Q,
    `${both(DAYDREAM_COPY.questions.line)} ${both(DAYDREAM_COPY.questions.why)} It thinks every ${d.cadenceMinutes} minutes between ${d.activeHours.start}:00 and ${d.activeHours.end}:00. ` +
    `Channels it starts from: ${list(d.channels.map((c) => c.label))}. Outcomes it looks for: ${list(d.outcomes.map((o) => o.label))}. ` +
    `${d.skipped.length} of the ${d.pairCount} channel and outcome pairings are never asked.`);
  add('daydream', 'questions', 'Pairings it never asks, and why', Q, d.skipped.map((s) => `${s.channel} × ${s.outcome}: ${s.why}.`).join(' '));
  add('daydream', 'questions', 'Private data or the web, never both', Q,
    `${both(DAYDREAM_COPY.questions.privacy)} Private cycles have ${d.tools.private} read-only tools; research cycles have ${d.tools.web} web tools.`);
  add('daydream', 'inbox', 'The stages of a daydream note', I,
    `${both(DAYDREAM_COPY.inbox.line)} ` + d.stages.map((s) => `${s.label}: ${s.explain} ${STAGE_ENG[s.id as keyof typeof STAGE_ENG]}`).join(' '));
  add('daydream', 'inbox', 'The double-check (commissions)', I,
    `${both(DAYDREAM_COPY.inbox.check)} ` + d.commissions.map((c) => `${c.label} (next to act: ${c.actor}): ${both(COMMISSION_COPY[c.id as keyof typeof COMMISSION_COPY])}`).join(' '));
  add('daydream', 'impact', 'How daydream is judged', M,
    `${both(DAYDREAM_COPY.impact.line)} The window is ${d.impactWindowDays} days.`);
  add('daydream', 'impact', 'Daydream caps and limits', M,
    `${both(DAYDREAM_COPY.impact.caps)} At most ${d.dailyRaiseCap} notes are raised a day, ${d.maxNotesPerCycle} notes per thought, ${d.maxRounds} model rounds and ${d.maxToolCalls} tool calls per thought.`);

  // Build
  const BL = href('build', 'backlog'), DV = href('build', 'develop'), VF = href('build', 'verify'), CG = href('build', 'codegraph');
  add('build', 'backlog', 'Where build ideas come from', BL,
    `${both(BUILD_COPY.backlog.line)} Sources: ${list(b.ideaSources.map((s) => SOURCE_COPY[s as keyof typeof SOURCE_COPY]))}. ` +
    `The board's stages: ${list(b.workStages.map((s) => `${s.label} (${s.question})`))}.`);
  add('build', 'backlog', 'The nightly self-improvement run', BL,
    Object.entries(PHASE_COPY).map(([k, v]) => `${k}: ${both(v)}`).join(' ') +
    ` Caps: at most $${b.night.maxCostUsd.toFixed(2)} and ${b.night.maxLlmCalls} model calls, ${b.night.maxWallMinutes} minutes, ${b.night.maxDeliveries} new delivery and ${b.night.maxToolsRepaired} tool repairs a night. It waits for ${b.idleMinutes} minutes of nobody using the site.`);
  add('build', 'backlog', 'The heartbeat schedule', BL,
    b.activities.map((x) => `${x.name} ${ACTIVITY_COPY[x.name]}, every ${x.cadenceMinutes} minutes${x.window ? ` between ${x.window}` : ''}.`).join(' '));
  add('build', 'develop', 'A delivery from brief to deployed', DV,
    `${both(BUILD_COPY.develop.line)} ` + Object.values(DELIVERY_COPY).map((v) => `${v.label}: ${both(v)}`).join(' '));
  add('build', 'develop', 'Release policies and lanes', DV,
    b.releasePolicies.map((p) => `${p.label}: ${both(POLICY_COPY[p.id as keyof typeof POLICY_COPY])}`).join(' ') +
    ' Lanes: ' + b.briefLanes.map((l) => `${l} ${BRIEF_LANE_COPY[l as keyof typeof BRIEF_LANE_COPY]}`).join('; ') + '.');
  add('build', 'develop', 'Autopilot and the build budget', DV,
    `${both(BUILD_COPY.develop.autopilot)} Autopilot takes ${b.autopilotRounds.default} rounds by default and ${b.autopilotRounds.max} at most. ` +
    `A build may take ${b.budget.maxIterations} iterations and ${b.budget.maxMinutes} minutes, and stops after ${b.budget.maxIdleIterations} iterations that change nothing. ` +
    `On the live board deliveries are grouped as: ${list(Object.values(LANE_COPY))}.`);
  add('build', 'verify', 'How a build is verified', VF,
    `${both(BUILD_COPY.verify.line)} ` + Object.values(VERIFY_COPY).map((v) => `${v.label}: ${both(v)}`).join(' ') +
    ` Gates: ${list(b.gates.map((g) => `${g} (${GATE_COPY[g as keyof typeof GATE_COPY]})`))}.`);
  add('build', 'verify', 'What a build may never touch alone', VF, both(BUILD_COPY.verify.rails));
  add('build', 'codegraph', 'Codegraph, the build history graph', CG,
    `${both(BUILD_COPY.codegraph.line)} Edges: ${list(b.codegraph.edgeKinds.map((k) => `${k} (${EDGE_COPY[k as keyof typeof EDGE_COPY]})`))}. ` +
    `A query may walk ${b.codegraph.maxHops} hops and return ${b.codegraph.maxLimit} results, within ${b.codegraph.maxBudget} characters.`);
  add('build', 'codegraph', 'How a lesson is ranked', CG,
    `${both(BUILD_COPY.codegraph.ranking)} Verdict weights: ${list(b.codegraph.verdicts.map((v) => `${v.id} ${v.weight}`))}. ` +
    `Ranking leans on outcomes over recency once ${b.codegraph.evidenceMaturity} serves are resolved.`);

  // App
  const SF = href('app', 'surfaces'), AP = href('app', 'api'), PR = href('app', 'privacy');
  add('app', 'surfaces', 'The app\'s tabs and screens', SF,
    `${both(APP_COPY.surfaces.line)} Tabs: ${list(APP.tabs.map((t) => `${t} (${TAB_COPY[t] ?? ''})`))}. More: ${list(APP.morePages.map((m) => `${m} (${MORE_COPY[m] ?? ''})`))}.`);
  add('app', 'surfaces', 'Widgets, Live Activities, the watch and Siri', SF,
    [...APP.widgets, ...APP.complications].map((w) => `${w.name} on the ${SURFACE_COPY[w.surface]?.label ?? w.surface}${w.description ? `: ${w.description}` : ''}.`).join(' ') +
    ` Watch pages: ${list(APP.watchPages.map((p) => `${p} (${WATCH_COPY[p] ?? ''})`))}. Siri can: ${list(APP.intents.map((i) => i.title))}. ` +
    `In the background: ${list(APP.backgroundModes.map((m) => (BACKGROUND_COPY[m] ? `${m} (${both(BACKGROUND_COPY[m])})` : m)))}. Games: ${list(APP.games.map((g) => g.title))}.`);
  add('app', 'api', 'The native API', AP,
    `${both(APP_COPY.api.line)} Areas: ${list(a.nativeAreas.map((x) => `${x.area} (${x.endpoints} endpoints, ${AREA_COPY[x.area] ?? ''})`))}.`);
  add('app', 'api', 'Pairing and push', AP,
    `${both(APP_COPY.api.pairing)} A pairing code lasts ${a.pairCodeMinutes} minutes and a device key ${a.deviceTokenDays} days. ${both(APP_COPY.api.push)}`);
  add('app', 'privacy', 'The app\'s permissions and capabilities', PR,
    `${both(APP_COPY.privacy.line)} Permissions: ${list(APP.permissions.map((p) => `${p} (${PERMISSION_COPY[p] ?? ''})`))}. ` +
    `Capabilities: ${list(APP.entitlements.map((e) => `${e} (${ENTITLEMENT_COPY[e] ?? ''})`))}.`);

  return out;
}

const CHUNKS: Chunk[] = buildChunks();

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'be', 'by', 'with', 'as', 'at', 'it', 'its', 'this', 'that', 'these', 'those', 'from', 'into', 'than', 'then', 'but', 'not', 'no', 'do', 'does', 'how', 'what', 'why', 'when', 'where', 'which', 'who', 'whom', 'can', 'could', 'would', 'should', 'will', 'about', 'i', 'you', 'we', 'they', 'he', 'she', 'me', 'my', 'our', 'your']);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 2 && !STOP.has(t));
}

// Bridges between what a reader asks and what the study calls the thing. Expansion is
// per-term, so every word a reader is likely to type needs its own entry.
const GROUPS: string[][] = [
  ['daydream', 'daydreams', 'daydreaming', 'idle', 'think', 'thinks', 'thinking', 'thought', 'thoughts', 'notice', 'notices', 'noticed', 'note', 'notes'],
  ['question', 'questions', 'schedule', 'rotation', 'rotate', 'channel', 'channels', 'outcome', 'outcomes', 'pair', 'pairs', 'pairing', 'next', 'decide', 'decides', 'choose', 'chooses'],
  ['inbox', 'stage', 'stages', 'spotted', 'verdict', 'verdicts', 'useful', 'decision', 'journey', 'move'],
  ['check', 'double', 'commission', 'commissions', 'recheck', 'verify', 'argue', 'approve', 'approval'],
  ['impact', 'score', 'scored', 'judged', 'measure', 'measured', 'hit', 'rate', 'funnel', 'week', 'weeks', 'weekly'],
  ['private', 'privacy', 'personal', 'data', 'web', 'internet', 'search', 'leak', 'safe'],
  ['cap', 'caps', 'limit', 'limits', 'budget', 'budgets', 'cost', 'costs', 'money', 'spend', 'cheap', 'expensive', 'many', 'often'],
  ['build', 'builds', 'builder', 'building', 'develop', 'development', 'delivery', 'deliveries', 'feature', 'features', 'code', 'change', 'changes', 'itself'],
  ['backlog', 'idea', 'ideas', 'queue', 'intake', 'board', 'source', 'sources', 'proposed'],
  ['night', 'nightly', 'overnight', 'self', 'improve', 'improvement', 'phase', 'phases', 'repair', 'heartbeat', 'scheduled', 'cron'],
  ['release', 'ship', 'ships', 'shipped', 'deploy', 'deployed', 'production', 'live', 'merge', 'merges', 'pull', 'pr', 'policy', 'github'],
  ['autopilot', 'unattended', 'autonomous', 'alone', 'ask', 'asks', 'human', 'without', 'permission'],
  ['test', 'tests', 'gate', 'gates', 'ci', 'check', 'checks', 'verification', 'proof', 'protected', 'safety', 'guardrail', 'guardrails'],
  ['codegraph', 'graph', 'lesson', 'lessons', 'memory', 'remember', 'history', 'edge', 'edges', 'rank', 'ranking', 'query'],
  ['app', 'iphone', 'phone', 'ios', 'mobile', 'native', 'pocket', 'swift'],
  ['widget', 'widgets', 'lock', 'screen', 'dynamic', 'island', 'activity', 'activities', 'complication', 'complications', 'watch', 'siri', 'shortcut', 'shortcuts', 'tab', 'tabs', 'surface', 'surfaces'],
  ['api', 'endpoint', 'endpoints', 'route', 'routes', 'server', 'site', 'doorway'],
  ['pair', 'pairing', 'paired', 'token', 'key', 'keys', 'sign', 'login', 'auth', 'trusted', 'family', 'member', 'members'],
  ['push', 'notification', 'notifications', 'notify', 'alert', 'alerts', 'apns'],
  ['permission', 'permissions', 'capability', 'capabilities', 'entitlement', 'entitlements', 'location', 'health', 'camera', 'microphone', 'motion'],
  ['keep', 'keeps', 'up', 'date', 'stale', 'drift', 'dynamic', 'automatic', 'automatically', 'manifest', 'updated'],
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
