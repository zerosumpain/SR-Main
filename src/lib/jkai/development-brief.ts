/**
 * The checks a brief must pass before the development lane will build it.
 *
 * Pure on purpose: the same rules run when the owner presses Accept, when a
 * brief is groomed, and when an unattended run decides whether it may accept a
 * brief itself — and only a pure function can be pinned by a test for all three.
 * The server half (`development-brief.server.ts`) supplies the two things this
 * cannot: the route manifest and the one model pass over the criteria.
 *
 * WHY IT EXISTS. The 2026-09-25 review of /jkai/develop: five of six asks were
 * standalone explainers or toys the Studio lane exists for; "a random sausage
 * generator" was groomed into a /marble-run feature although Marble Run lives
 * in its own repository, accepted four minutes later, and the builder then
 * escalated. Briefs were being accepted in seconds with criteria no browser or
 * diff could confirm and target routes that did not exist. Each of those is a
 * fact checkable before a token is spent on implementation.
 */
import registry from '$lib/estate/registry/apps.generated.json';
import { BRIEF_LANES, type BriefFinding, type BriefLane, type BriefLaneKind, type BriefLint, type DeliveryState } from '$lib/constants/development';

/**
 * Games and standalone apps that are their own repositories, built to `dist/`
 * and served from `data/jkai-projects/<slug>/` — not in the SR-Infra app
 * registry, because nothing routes to them but the static bundle route. The list
 * is the one in memory `project_module_boundary_gate`; the rule that put them
 * there is the lane rule itself: does it need the platform at runtime? No → own
 * repo. `names` are only the DISTINCTIVE ones — "whitehall" and "archetype" are
 * ordinary words, so those two are recognised by their route alone.
 */
export const STANDALONE_REPOS: Array<{ slug: string; repo: string; names: RegExp[] }> = [
  { slug: 'marble-run', repo: 'zerosumpain/marble-run', names: [/\bmarble[\s-]?runs?\b/i] },
  { slug: 'brass-and-rails', repo: 'zerosumpain/brass-and-rails', names: [/\bbrass\s*(?:and|&|-)\s*rails\b/i] },
  { slug: 'space-lander', repo: 'zerosumpain/space-lander', names: [/\bspace[\s-]?lander\b/i] },
  { slug: 'smashamole', repo: 'zerosumpain/smashamole', names: [/\bsmash[\s-]?a[\s-]?mole\b/i] },
  { slug: 'whitehall', repo: 'zerosumpain/whitehall', names: [] },
  { slug: 'archetype', repo: 'zerosumpain/archetype', names: [] },
  { slug: 'offline-maps', repo: 'zerosumpain/offline-maps', names: [] },
  { slug: 'scs-earnings', repo: 'zerosumpain/scs-earnings', names: [] },
  { slug: 'sr-docs', repo: 'zerosumpain/sr-docs', names: [] },
];

/** Registry apps whose names are distinctive enough to recognise in prose. */
const APP_NAMES: Record<string, RegExp> = {
  'policy-engine': /\bpolicy[\s-]engine\b/i,
  'dfe-data-strategy': /\bdfe data strategy\b/i,
  'data-standard-designer': /\bdata[\s-]standard[\s-]designer\b/i,
  'local-plan-navigator': /\blocal[\s-]plan[\s-]navigator\b/i,
};

type RegistryApp = { key: string; repo: string; status: string; paths: string[]; excludePaths: string[] };
const APPS = (registry.apps as RegistryApp[]).filter(a => a.key !== 'main' && a.status === 'live');
const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);

/** `/health/`, `/health?x=1` and `/health#y` are all `/health`. */
export function normaliseRoute(route: string): string {
  const bare = route.trim().replace(/[?#].*$/, '');
  return bare.length > 1 ? bare.replace(/\/+$/, '') : bare;
}

/**
 * The repository that serves a path, when it is not SR-Main. Mirrors the edge:
 * an app claims its prefixes minus its `excludePaths`, first match in
 * `routeOrder` wins, and SR-Main is the fallback. A standalone bundle claims
 * `/projects/<slug>` — and a bare `/<slug>`, which is the exact shape of the
 * /marble-run route the sausage generator was groomed into.
 */
export function routeOwner(route: string): { repo: string; name: string } | null {
  const path = normaliseRoute(route);
  const ordered = [...APPS].sort((a, b) => registry.routeOrder.indexOf(a.key) - registry.routeOrder.indexOf(b.key));
  for (const app of ordered) {
    if (app.paths.some(p => under(path, p)) && !app.excludePaths.some(p => under(path, p))) return { repo: app.repo, name: app.key };
  }
  for (const bundle of STANDALONE_REPOS) {
    if (under(path, `/projects/${bundle.slug}`) || under(path, `/${bundle.slug}`)) return { repo: bundle.repo, name: bundle.slug };
  }
  return null;
}

/** The grooming model's lane, or undefined when it gave none worth reading. */
export function parseLane(raw: unknown): Omit<BriefLane, 'source'> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { lane, reason, repo } = raw as Record<string, unknown>;
  if (typeof lane !== 'string' || !BRIEF_LANES.includes(lane as BriefLaneKind)) return undefined;
  const why = typeof reason === 'string' ? reason.trim().split('\n')[0].slice(0, 300) : '';
  return { lane: lane as BriefLaneKind, reason: why || 'No reason given.', ...(typeof repo === 'string' && repo.trim() ? { repo: repo.trim().slice(0, 100) } : {}) };
}

export interface BriefInput {
  outcome: string;
  criteria: string[];
  routes: string[];
  newRoutes?: string[];
  /** The model's proposal, if the brief was groomed. */
  lane?: Omit<BriefLane, 'source'>;
}

/**
 * The lane verdict. A deterministic rule beats the model: a target route served
 * by another repository, or the brief naming a standalone game, is evidence,
 * whereas the model's lane is an opinion. The rule only ever moves a brief OUT
 * of the site lane — it never declares something belongs here.
 */
export function briefLane(input: BriefInput): BriefLane {
  for (const route of [...input.routes, ...(input.newRoutes ?? [])]) {
    const owner = routeOwner(route);
    if (owner) return { lane: 'other-repo', repo: owner.repo, source: 'rule', reason: `${normaliseRoute(route)} is served by ${owner.repo}, not SR-Main.` };
  }
  const text = [input.outcome, ...input.criteria].join('\n');
  for (const bundle of STANDALONE_REPOS) {
    if (bundle.names.some(n => n.test(text))) return { lane: 'other-repo', repo: bundle.repo, source: 'rule', reason: `The brief names ${bundle.slug}, which lives in ${bundle.repo}.` };
  }
  for (const app of APPS) {
    if (APP_NAMES[app.key]?.test(text)) return { lane: 'other-repo', repo: app.repo, source: 'rule', reason: `The brief names ${app.key}, which lives in ${app.repo}.` };
  }
  if (input.lane) return { ...input.lane, source: 'grooming' };
  return { lane: 'site', source: 'unchecked', reason: 'This brief was never groomed, so its lane was not checked. Nothing in it names another repository.' };
}

/**
 * A SvelteKit route pattern as a matcher. `[x]` is one segment, `[[x]]` an
 * optional one, `[...x]` any remainder. Route groups are already stripped by
 * the snapshot (`scripts/lib/codegraph-snapshot.mjs`).
 */
function patternMatcher(pattern: string): RegExp {
  const parts = pattern.split('/').filter(Boolean).map(seg => {
    if (/^\[\.\.\.[^\]]+\]$/.test(seg)) return '(?:/.*)?';
    if (/^\[\[[^\]]+\]\]$/.test(seg)) return '(?:/[^/]+)?';
    return '/' + seg.split(/(\[[^\]]+\])/).map(piece => /^\[[^\]]+\]$/.test(piece) ? '[^/]+' : piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  });
  return new RegExp(`^${parts.join('') || ''}/?$`);
}
/** Parameter names do not matter: `/blog/[slug]`, `/blog/:id` and `/blog/{post}` are one route. */
const shape = (route: string) => normaliseRoute(route).replace(/\[\[?(?:\.\.\.)?[^\]]+\]\]?|:[\w-]+|\{[^}]+\}|<[^>]+>/g, '[]');

export function routeExists(route: string, manifest: string[]): boolean {
  const path = normaliseRoute(route);
  const wanted = shape(path);
  return manifest.some(pattern => shape(pattern) === wanted || patternMatcher(pattern).test(path));
}

// ── criteria ────────────────────────────────────────────────────────────────

/** Words a reviewer cannot check on their own: whose "intuitive"? how "fast"? */
const SUBJECTIVE = /\b(user[\s-]?friendly|intuitive(?:ly)?|seamless(?:ly)?|robust(?:ly)?|scalable|performant|clean(?:ly)?|nice(?:ly)?|beautiful(?:ly)?|delightful|engaging|fun|easy to (?:use|understand)|high[\s-]quality|modern|elegant(?:ly)?|well[\s-](?:designed|structured|tested|written|organi[sz]ed)|polished|maintainable|best practices?|as expected|works? (?:well|properly|correctly)|properly|appropriately|good (?:ux|experience|performance))\b/i;
/** Something a browser or a diff can actually show. */
const OBSERVABLE = /(\/[a-z0-9]|\b(shows?|showing|displays?|renders?|lists?|appears?|visible|hidden|reads?|labelled|says|heading|button|link|tab|field|input|form|table|chart|row|column|card|click(?:ing|s)?|tap(?:ping|s)?|press(?:ing|es)?|enter(?:ing|s)?|types?|select(?:ing|s)?|submit(?:ting|s)?|reload(?:ing|s)?|loads?|navigat\w*|scroll\w*|returns?|responds?|status|http|\d{3}|error message|empty state|test|tests|file|stored|saved|persists?|within \d|\d+\s*(?:ms|s|seconds?|px|items?|rows?)|at (?:phone|mobile|desktop) width)\b)/i;
/** Asks for something the synthetic preview database cannot hold or the disconnected providers cannot send. */
const LIVE_DATA = /\b(production(?: data| database| site)?|prod (?:data|db)|on strangeramblings\.com|live (?:data|feed|readings?|account|provider|api|site)|real(?:[\s-]world)? (?:data|readings?|emails?|messages?|accounts?|users?|locations?)|my (?:actual|real|own|live) \w+|actual (?:data|readings?|emails?|messages?|location)|today'?s (?:real|actual|live) )/i;
const PROVIDERS = /\b(whoop|life360|gmail|google calendar|strava|garmin|home assistant|alexa|whatsapp|hue|tado|spotify|mapbox|openrouter|github api|apns|push notifications?|e-?mail(?:s|ed)?|sms|texts? (?:me|the owner))\b/i;
const PROVIDER_LIVE = /\b(connects?|connected|syncs?|synced|fetch(?:es|ed)?|pulls?|calls?|imports? from|receives?|delivers?|sends?|sent|posts? to|notif(?:y|ies|ied)|messages? (?:me|the owner))\b/i;
const SAMPLE = /\b(sample|synthetic|fixture|mock(?:ed)?|placeholder|seeded|stub(?:bed)?|fake|test data|demo data|labelled as)\b/i;

/** Heuristic checks on one criterion. The model pass, when it runs, adds to these. */
export function criterionFindings(text: string): BriefFinding[] {
  const findings: BriefFinding[] = [];
  const words = text.trim().split(/\s+/).filter(Boolean);
  const add = (kind: BriefFinding['kind'], message: string, severity: BriefFinding['severity'] = 'block') => findings.push({ kind, severity, subject: text, message, source: 'rule' });
  if (words.length < 4) add('criterion', 'Too short to check. Say what a reviewer would see or do, and what happens.');
  else if (SUBJECTIVE.test(text) && !OBSERVABLE.test(text.replace(new RegExp(SUBJECTIVE.source, 'gi'), ''))) {
    add('criterion', `"${SUBJECTIVE.exec(text)?.[0]}" is a judgement, not an observation. Name what a reviewer would see in the preview or the diff.`);
  } else if (!OBSERVABLE.test(text)) {
    add('criterion', 'Names nothing a browser or a diff could show — no page, control, visible result or file.', 'warn');
  }
  if (!SAMPLE.test(text)) {
    if (LIVE_DATA.test(text)) add('preview', 'Needs production or live data. The preview runs on a synthetic database, so restate it against sample data.');
    else if (PROVIDERS.test(text) && PROVIDER_LIVE.test(text)) add('preview', `Needs ${PROVIDERS.exec(text)?.[0]} to be connected. Providers are disconnected in the preview, so restate it as what the page shows with sample or missing data.`);
    else if (PROVIDERS.test(text)) add('preview', `Mentions ${PROVIDERS.exec(text)?.[0]}, which is disconnected in the preview. Make sure this can be checked with sample data.`, 'warn');
  }
  return findings;
}

/**
 * Lint a brief. `manifest` is the list of SR-Main route patterns, or null when
 * none was available — then existing routes go unchecked and `routesChecked`
 * says so, which an unattended run treats as a reason not to accept.
 */
export function lintBrief(input: BriefInput, manifest: string[] | null, revision: number, at = new Date().toISOString()): BriefLint {
  const findings: BriefFinding[] = [];
  const lane = briefLane(input);
  if (lane.lane !== 'site') findings.push({ kind: 'lane', severity: 'block', subject: lane.lane, message: lane.reason, source: lane.source === 'rule' ? 'rule' : 'model' });
  const newRoutes = new Set((input.newRoutes ?? []).map(normaliseRoute));
  for (const route of input.routes.map(normaliseRoute)) {
    if (!route.startsWith('/') || route.startsWith('//')) findings.push({ kind: 'route', severity: 'block', subject: route, message: 'Not a local site path.', source: 'rule' });
    else if (newRoutes.has(route)) continue;
    else if (manifest && !routeExists(route, manifest)) findings.push({ kind: 'route', severity: 'block', subject: route, message: 'This route does not exist on the site. Correct it, or list it under new routes if the feature creates it.', source: 'rule' });
  }
  for (const route of newRoutes) {
    if (!route.startsWith('/') || route.startsWith('//')) findings.push({ kind: 'route', severity: 'block', subject: route, message: 'Not a local site path.', source: 'rule' });
    else if (manifest && routeExists(route, manifest)) findings.push({ kind: 'route', severity: 'warn', subject: route, message: 'Proposed as new, but the site already serves this path. Move it to target routes if the feature changes the existing page.', source: 'rule' });
  }
  if (!input.routes.length && !newRoutes.size) findings.push({ kind: 'route', severity: 'warn', subject: '', message: 'No target route. The first milestone is a working page, so name the page a reviewer should open.', source: 'rule' });
  if (!input.criteria.length) findings.push({ kind: 'criterion', severity: 'block', subject: '', message: 'Add at least one acceptance criterion.', source: 'rule' });
  for (const criterion of input.criteria) findings.push(...criterionFindings(criterion));
  return { revision, at, lane, findings, routesChecked: manifest !== null };
}

/** Parse the judge's reply. Unreadable means no findings, never a block: the rules already ran. */
export function parseCriteriaJudgement(content: string, criteria: string[]): BriefFinding[] {
  try {
    const raw = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as { criteria?: Array<{ index?: unknown; checkable?: unknown; reason?: unknown }> };
    return (raw.criteria ?? []).flatMap(entry => {
      const index = Number(entry.index);
      if (entry.checkable !== false || !Number.isInteger(index) || !criteria[index]) return [];
      const reason = typeof entry.reason === 'string' && entry.reason.trim() ? entry.reason.trim().slice(0, 300) : 'A reviewer could not confirm this from the preview or the diff.';
      return [{ kind: 'criterion' as const, severity: 'block' as const, subject: criteria[index], message: reason, source: 'model' as const }];
    });
  } catch { return []; }
}

export const blockingFindings = (lint: BriefLint) => lint.findings.filter(f => f.severity === 'block');

/** A finding's identity, so an override can name exactly what it was given for. */
export const findingKey = (f: Pick<BriefFinding, 'kind' | 'subject' | 'message'>) => `${f.kind}|${f.subject}|${f.message}`;
export const laneKey = (lane: Pick<BriefLane, 'lane' | 'repo'>) => `lane|${lane.lane}|${lane.repo ?? ''}`;
/**
 * What ticking the overrides acknowledges: the lane as shown and each blocking
 * finding as shown. The page sends this with Accept, so an override covers the
 * problems the owner actually read — an edit that introduces a new one is
 * checked afresh rather than waved through by an old tick.
 */
export function acknowledgementKeys(lint: BriefLint): string[] {
  return [...(lint.lane.lane !== 'site' ? [laneKey(lint.lane)] : []), ...blockingFindings(lint).filter(f => f.kind !== 'lane').map(findingKey)];
}

function laneMessage(lint: BriefLint): string {
  return lint.lane.lane === 'studio'
    ? `This looks like a standalone piece for the Studio lane, not a site change: ${lint.lane.reason} Commission it there, or confirm it belongs on the site.`
    : `This belongs in ${lint.lane.repo ?? 'another repository'}: ${lint.lane.reason} Commission it there, or confirm it belongs on the site.`;
}

/**
 * Why the owner may not accept this brief yet, or null. The lane and the lint
 * are separate overrides on purpose: "build it on the site anyway" is a
 * decision about where the work belongs, and "accept despite these findings"
 * is one about how well it is specified — ticking one is not the other. Each
 * covers only what `acknowledged` names (see `acknowledgementKeys`).
 */
export function briefAcceptanceBlocker(lint: BriefLint, override: { lane?: boolean; lint?: boolean; acknowledged?: string[] } = {}): string | null {
  const seen = new Set(override.acknowledged ?? []);
  if (lint.lane.lane !== 'site' && !(override.lane && seen.has(laneKey(lint.lane)))) {
    return override.lane ? `The lane check changed since you confirmed it. ${laneMessage(lint)}` : laneMessage(lint);
  }
  const blocking = blockingFindings(lint).filter(f => f.kind !== 'lane');
  const unseen = override.lint ? blocking.filter(f => !seen.has(findingKey(f))) : blocking;
  if (!unseen.length) return null;
  const count = `${unseen.length} ${override.lint ? 'new ' : ''}problem${unseen.length === 1 ? '' : 's'}`;
  return `The brief has ${count} to fix before it is built${override.lint ? ' (your override covered only the ones you saw)' : ''}: ${unseen[0].message}${unseen.length > 1 ? ' See the brief check for the rest.' : ''}`;
}

// ── the unattended path ─────────────────────────────────────────────────────

/**
 * How long a brief the OWNER groomed is left alone before autopilot judges it.
 * Arming autopilot at commission lands the owner on a page that grooms the ask
 * in front of them; accepting it out from under them a minute later, or pushing
 * "Autopilot needs you" while they are reading it, is the wrong way round.
 */
export const BRIEF_GRACE_MS = 10 * 60 * 1000;

export type BriefDecision =
  | { action: 'wait' }
  | { action: 'groom' }
  | { action: 'lint' }
  | { action: 'answer'; questions: string[] }
  | { action: 'accept' }
  | { action: 'stop'; reason: string };

export const briefQuestions = (state: DeliveryState) => (state.brief.questions ?? '').split('\n').map(q => q.trim()).filter(Boolean);

/**
 * What an unattended run does with a brief nobody has accepted. Pure, like
 * `restartDecision`, so each way it can stop is pinned by a test. One action per
 * sweep: groom (once — a run never re-grooms its own brief into acceptability),
 * lint, answer the brief's remaining questions from the brief, accept. Anything
 * the lane check or the lint objects to ends the run with the reason, because
 * those are exactly the judgements an owner override exists for.
 */
export function autopilotBriefDecision(state: DeliveryState, now: number): BriefDecision {
  if (state.brief.acceptedAt) return { action: 'wait' };
  // The grace starts at commission, not at the first grooming: the owner's page
  // grooms on mount, and if this run's grooming won that race the brief would
  // read as autopilot's own and be accepted while the owner was reading it.
  const since = (at: string | undefined) => { const t = Date.parse(at ?? ''); return Number.isFinite(t) ? t : 0; };
  if (!state.grooming) return now - since(state.autopilot?.startedAt) < BRIEF_GRACE_MS ? { action: 'wait' } : { action: 'groom' };
  // Only the OWNER's writes restart the grace; autopilot's own check does not.
  const ownerTouched = Math.max(state.grooming.by !== 'autopilot' ? since(state.grooming.at) : 0,
    state.brief.lint && state.brief.lint.by !== 'autopilot' ? since(state.brief.lint.at) : 0);
  if (now - ownerTouched < BRIEF_GRACE_MS) return { action: 'wait' };
  const lint = state.brief.lint;
  if (!lint || lint.revision !== state.brief.revision) return { action: 'lint' };
  const refuse = (why: string): BriefDecision => ({ action: 'stop', reason: `Autopilot will not accept this brief on its own${why}` });
  if (lint.lane.lane !== 'site') return refuse(`. ${laneMessage(lint)}`);
  // "site" by default is not a verdict. An old brief or a grooming that returned
  // no readable lane has never been asked where it belongs.
  if (lint.lane.source === 'unchecked') return refuse(': its lane was never checked. Refine the brief so grooming proposes one, or accept it yourself.');
  const blocking = blockingFindings(lint);
  if (blocking.length) return refuse(`: ${blocking.length} problem${blocking.length === 1 ? '' : 's'} in the brief check. ${blocking[0].subject ? `"${blocking[0].subject.slice(0, 80)}": ` : ''}${blocking[0].message}`);
  if (!lint.routesChecked) return refuse(': no route manifest was available, so its target routes could not be checked.');
  // The model pass is optional for a person, who reads the criteria; for an
  // unattended run it is the only reader, so a pass that errored or timed out
  // is a reason to stop, not something to skip quietly.
  if (state.criteria.length && !lint.judged) return refuse(': the reviewer model could not check its criteria. Check them and accept it yourself.');
  const questions = briefQuestions(state);
  if (questions.length) return { action: 'answer', questions };
  return { action: 'accept' };
}

// ── the groomed brief ───────────────────────────────────────────────────────
//
// One brief model since 2026-10-02. The improvement backlog used to keep its
// own (`selfimprove/grooming.ts`) with its own groomer, and an accepted
// backlog item was re-groomed from scratch once it reached /jkai/develop. Now a
// groomed backlog item carries the development brief's own fields — target
// routes, proposed routes, the lane and the brief check — beside the backlog's
// planning fields (problem, non-goals, effort, risk, relations, notes,
// conversation), and `deliveryBriefFrom` hands it to a delivery unchanged.
//
// Still pure: the backlog editor value-imports the readiness rule and the line
// helpers from here, so nothing below may reach the database or private env.

export const BRIEF_WORK_KINDS = ['tool', 'feature', 'source', 'watch', 'engine'] as const;
export type BriefWorkKind = (typeof BRIEF_WORK_KINDS)[number];
export const BACKLOG_EFFORTS = ['small', 'medium', 'large'] as const;
export const BACKLOG_RISKS = ['low', 'medium', 'high'] as const;
export const BACKLOG_RELATIONS = ['duplicate', 'related', 'blocks', 'blocked_by'] as const;
export type BacklogEffort = (typeof BACKLOG_EFFORTS)[number];
export type BacklogRisk = (typeof BACKLOG_RISKS)[number];
export type BacklogRelationKind = (typeof BACKLOG_RELATIONS)[number];
/** Whether the brief can be handed to an automated builder without guessing. */
export type BacklogReadinessStatus = 'draft' | 'needs_input' | 'ready';

/** A relationship may only point at another durable backlog slug. */
export interface BacklogRelation { slug: string; title: string; kind: BriefWorkKind; relation: BacklogRelationKind; reason: string }
/** One turn of the grooming conversation, as stored. */
export interface BacklogGroomingTurn { role: 'user' | 'assistant'; content: string }
/**
 * A note the owner (or the model, at the owner's request) left on one item.
 * `author` is stamped by the route, never read out of the request body.
 */
export interface BacklogNote { id: string; at: string; author: 'owner' | 'model'; text: string }

/**
 * The groomed brief: the contract between grooming and every build lane.
 *
 * `conversation` is kept for a person resuming the grooming but is never fed
 * to a builder — a lane must not reconstruct decisions out of chat. `routes`,
 * `newRoutes`, `lane` and `lint` are the development brief's fields; they are
 * optional because briefs groomed before the two models were one lack them,
 * and such a brief is read as it was stored (its delivery grooms it afresh).
 */
export interface GroomedBrief {
  problem: string;
  outcome: string;
  acceptanceCriteria: string[];
  constraints: string[];
  nonGoals: string[];
  dependencies: string[];
  implementationNotes: string[];
  validation: string[];
  assumptions: string[];
  openQuestions: string[];
  decisions: string[];
  relatedItems: BacklogRelation[];
  effort: BacklogEffort;
  risk: BacklogRisk;
  readiness: { score: number; status: BacklogReadinessStatus; reason: string };
  assistantSummary: string;
  /** The resolved model actually called, not merely the configured setting. */
  modelId: string;
  groomedAt: string;
  /** Set when a person saves the model draft into the backlog record. */
  acceptedAt?: string;
  revision: number;
  /** The thread that produced this brief. Display and continuation only. */
  conversation?: BacklogGroomingTurn[];
  /** Existing site paths the feature changes. */
  routes?: string[];
  /** Paths the feature proposes to create. */
  newRoutes?: string[];
  /** The grooming model's lane proposal. `lint.lane` is the verdict. */
  lane?: Omit<BriefLane, 'source'>;
  /** The brief check at grooming. Advisory here: a delivery checks again. */
  lint?: BriefLint;
}

/** Turns kept on a record, and notes kept on one. Values a `.svelte` may import. */
export const MAX_GROOMING_CONVERSATION = 24;
export const MAX_BACKLOG_NOTES = 100;
/** One note. Long enough for a paragraph of reasoning, not an essay. */
export const MAX_NOTE_LENGTH = 2_000;

const MAX_TEXT = 2_000;
const MAX_LIST_ITEM = 500;
const MAX_LIST = 20;

const clean = (value: unknown, max = MAX_TEXT) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export function stringList(value: unknown, limit = MAX_LIST): string[] {
  const input = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : [];
  return [...new Set(input.map((v) => clean(v, MAX_LIST_ITEM)).filter(Boolean))].slice(0, limit);
}

export const lines = (value: string): string[] => stringList(value);

/** Local site paths only, de-duplicated and normalised. */
function routeList(value: unknown): string[] {
  return [...new Set(stringList(value).map(normaliseRoute).filter((r) => r.startsWith('/') && !r.startsWith('//') && !/\s/.test(r)))];
}

export function calculateReadiness(input: {
  problem?: unknown; outcome?: unknown; acceptanceCriteria?: unknown; validation?: unknown; implementationNotes?: unknown; openQuestions?: unknown;
}): GroomedBrief['readiness'] {
  const problem = clean(input.problem);
  const outcome = clean(input.outcome);
  const criteria = stringList(input.acceptanceCriteria);
  const validation = stringList(input.validation);
  const notes = stringList(input.implementationNotes);
  const questions = stringList(input.openQuestions);

  let score = 0;
  if (problem) score += 20;
  if (outcome) score += 20;
  score += Math.min(30, criteria.length * 10);
  score += Math.min(15, validation.length * 8);
  score += Math.min(10, notes.length * 5);
  if (questions.length === 0) score += 5;
  score -= Math.min(28, questions.length * 7);
  score = Math.max(0, Math.min(100, score));

  let status: BacklogReadinessStatus = 'draft';
  if (questions.length > 0) status = 'needs_input';
  else if (score >= 80) status = 'ready';

  const missing: string[] = [];
  if (!problem) missing.push('problem');
  if (!outcome) missing.push('outcome');
  if (criteria.length < 3) missing.push('acceptance criteria');
  if (validation.length < 1) missing.push('validation');
  const reason = questions.length
    ? `${questions.length} open question${questions.length === 1 ? '' : 's'} still need a decision.`
    : missing.length
      ? `Strengthen ${missing.join(', ')} before an automated build.`
      : 'The problem, outcome, acceptance criteria and validation are explicit.';
  return { score, status, reason };
}

export interface GroomingCandidate { slug: string; title: string; kind: BriefWorkKind }

/** One backlog grooming turn's answer: the reply, item suggestions and the draft. */
export interface GroomingModelResult {
  assistantMessage: string;
  suggestions: { title: string; detail: string; kind: BriefWorkKind; priority: number };
  grooming: GroomedBrief;
  model: string;
}

export interface NormaliseGroomingOptions {
  modelId: string;
  groomedAt?: string;
  revision?: number;
  allowedRelations?: ReadonlyMap<string, GroomingCandidate>;
  assistantSummary?: string;
  /** The server's brief check. Only the server states one; see `readLint`. */
  lint?: BriefLint;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

/**
 * A stored or round-tripped brief check, kept only when it is shaped like one.
 * Advisory display: a delivery never trusts it, it checks the brief again.
 */
function readLint(raw: unknown): BriefLint | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const l = raw as Partial<BriefLint>;
  if (!l.lane || typeof l.lane !== 'object' || !BRIEF_LANES.includes(l.lane.lane) || !Array.isArray(l.findings)) return undefined;
  return {
    revision: Number(l.revision) || 1, at: clean(l.at, 100), routesChecked: l.routesChecked === true,
    lane: { lane: l.lane.lane, reason: clean(l.lane.reason, 300), source: enumValue(l.lane.source, ['grooming', 'rule', 'unchecked'] as const, 'unchecked'), ...(l.lane.repo ? { repo: clean(l.lane.repo, 100) } : {}) },
    findings: l.findings.slice(0, 60).filter((f) => f && typeof f === 'object').map((f) => ({
      kind: enumValue(f.kind, ['route', 'criterion', 'preview', 'lane'] as const, 'criterion'), severity: enumValue(f.severity, ['block', 'warn'] as const, 'warn'),
      subject: clean(f.subject, 1_000), message: clean(f.message, 500), source: enumValue(f.source, ['rule', 'model'] as const, 'rule'),
    })),
    ...(l.judged && typeof l.judged === 'object' ? { judged: { key: clean(l.judged.key, 64), model: clean(l.judged.model, 200) } } : {}),
  };
}

/** Turn model JSON or a browser round-trip into the one safe stored shape. */
export function normaliseGrooming(raw: unknown, options: NormaliseGroomingOptions): GroomedBrief {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const relatedItems: BacklogRelation[] = [];
  const seen = new Set<string>();
  for (const value of Array.isArray(obj.relatedItems) ? obj.relatedItems : []) {
    if (!value || typeof value !== 'object') continue;
    const rel = value as Record<string, unknown>;
    const slug = clean(rel.slug, 200);
    const candidate = options.allowedRelations?.get(slug);
    // Model-created relations are only accepted when the server supplied that
    // exact durable id. Persisted round-trips have no map and retain their ids.
    if (!slug || seen.has(slug) || (options.allowedRelations && !candidate)) continue;
    relatedItems.push({
      slug,
      title: candidate?.title || clean(rel.title, 200) || slug,
      kind: candidate?.kind ?? enumValue(rel.kind, BRIEF_WORK_KINDS, 'feature'),
      relation: enumValue<BacklogRelationKind>(rel.relation, BACKLOG_RELATIONS, 'related'),
      reason: clean(rel.reason, 500),
    });
    seen.add(slug);
    if (relatedItems.length >= 10) break;
  }

  const core = {
    problem: clean(obj.problem),
    outcome: clean(obj.outcome),
    acceptanceCriteria: stringList(obj.acceptanceCriteria),
    constraints: stringList(obj.constraints),
    nonGoals: stringList(obj.nonGoals),
    dependencies: stringList(obj.dependencies),
    implementationNotes: stringList(obj.implementationNotes),
    validation: stringList(obj.validation),
    assumptions: stringList(obj.assumptions),
    openQuestions: stringList(obj.openQuestions),
    decisions: stringList(obj.decisions),
  };
  const lane = parseLane(obj.lane);
  const lint = options.lint ?? readLint(obj.lint);

  return {
    ...core,
    relatedItems,
    effort: enumValue<BacklogEffort>(obj.effort, BACKLOG_EFFORTS, 'medium'),
    risk: enumValue<BacklogRisk>(obj.risk, BACKLOG_RISKS, 'medium'),
    // Deterministic, not model-authored, so the UI and the builder agree on
    // what "ready" means and a persuasive sentence cannot inflate it.
    readiness: calculateReadiness(core),
    assistantSummary: clean(options.assistantSummary ?? obj.assistantSummary, 1_000),
    modelId: clean(options.modelId || obj.modelId, 200),
    groomedAt: options.groomedAt ?? (clean(obj.groomedAt, 100) || new Date().toISOString()),
    revision: Math.max(1, Math.round(options.revision ?? (Number(obj.revision) || 1))),
    conversation: normaliseConversation(obj.conversation),
    routes: routeList(obj.routes),
    newRoutes: routeList(obj.newRoutes),
    ...(lane ? { lane } : {}),
    ...(lint ? { lint } : {}),
  };
}

/** Sanitize and mark the structured draft a person chose to save. */
export function acceptGrooming(raw: unknown, now = new Date().toISOString()): GroomedBrief {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    ...normaliseGrooming(raw, { modelId: clean(obj.modelId, 200), groomedAt: clean(obj.groomedAt, 100) || now, revision: Number(obj.revision) || 1 }),
    acceptedAt: now,
  };
}

/**
 * The stored shape of a grooming thread. Trimmed from the END, keeping the most
 * recent turns; a turn whose role is neither `user` nor `assistant` is dropped
 * rather than coerced — a mislabelled turn read back as the other party is
 * worse than a missing one.
 */
export function normaliseConversation(raw: unknown): BacklogGroomingTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: BacklogGroomingTurn[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const turn = value as Record<string, unknown>;
    if (turn.role !== 'user' && turn.role !== 'assistant') continue;
    const content = clean(turn.content, MAX_NOTE_LENGTH);
    if (content) turns.push({ role: turn.role, content });
  }
  return turns.slice(-MAX_GROOMING_CONVERSATION);
}

/**
 * One note, sanitised. `author` is NOT read from the input: the caller states
 * it, so a request cannot sign its content as something it is not.
 */
export function normaliseNote(raw: unknown, author: BacklogNote['author'], now = new Date().toISOString()): BacklogNote | null {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const body = clean(typeof raw === 'string' ? raw : obj.text, MAX_NOTE_LENGTH);
  if (!body) return null;
  return { id: clean(obj.id, 60) || `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, at: clean(obj.at, 100) || now, author, text: body };
}

function section(label: string, values: readonly string[] | undefined): string {
  return values?.length ? `\n${label}:\n${values.map((v) => `- ${v}`).join('\n')}` : '';
}

/** What `renderBacklogBrief` reads from a backlog item. */
export interface RenderableBrief {
  title: string;
  detail: string;
  grooming?: GroomedBrief;
  mergedBrief?: string;
  absorbedRequirements?: Record<string, string>;
}

/**
 * The canonical brief text handed to a build lane. Older rows keep their
 * original detail until they are groomed; the conversation is never included.
 */
export function renderBacklogBrief(item: RenderableBrief): string {
  const g = item.grooming;
  const merged = [item.mergedBrief, ...Object.values(item.absorbedRequirements ?? {})].filter(Boolean).map((brief) => `\n\nConsolidated requirements\n${brief}`).join('');
  if (!g) return `${item.title}\n\n${item.detail}${merged}`.trim();
  return [
    `Feature: ${item.title}`,
    `Problem: ${g.problem || item.detail || 'Not recorded'}`,
    `Desired outcome: ${g.outcome || item.detail || 'Not recorded'}`,
    `Delivery profile: ${g.effort} effort · ${g.risk} risk · ${g.readiness.status} (${g.readiness.score}/100)`,
    section('Acceptance criteria', g.acceptanceCriteria),
    section('Validation', g.validation),
    section('Target routes', g.routes),
    section('New routes', g.newRoutes),
    section('Constraints', g.constraints),
    section('Non-goals', g.nonGoals),
    section('Dependencies', g.dependencies),
    section('Implementation notes', g.implementationNotes),
    section('Decisions already made', g.decisions),
    section('Assumptions to verify', g.assumptions),
    section('Remaining open questions', g.openQuestions),
  ].filter(Boolean).join('\n') + merged;
}

const bullets = (xs: readonly string[] | undefined) => (xs ?? []).map((x) => x.trim()).filter(Boolean).map((x) => `- ${x}`).join('\n');

/** The fields of a delivery brief a groomed brief fills. */
export type GroomedDeliveryBrief = Partial<Pick<DeliveryState['brief'], 'constraints' | 'dependencies' | 'assumptions' | 'questions' | 'validation' | 'routes' | 'newRoutes' | 'lane'>>;

/**
 * A groomed brief as a delivery's brief: the same fields, so the delivery
 * starts from what the owner accepted rather than from a blank. `grooming` is
 * returned only when the brief was groomed by the one groomer (it has a lane):
 * then autopilot checks and accepts it instead of grooming it again. A brief
 * groomed before the models were one has no lane, so its delivery grooms it.
 */
export interface DeliveryBriefFields { criteria: string[]; brief: GroomedDeliveryBrief; grooming?: NonNullable<DeliveryState['grooming']> }
export function deliveryBriefFrom(g: GroomedBrief | undefined): DeliveryBriefFields {
  if (!g) return { criteria: [], brief: {} };
  const routes = g.routes ?? [];
  const newRoutes = g.newRoutes ?? [];
  return {
    criteria: g.acceptanceCriteria.map((c) => c.trim()).filter(Boolean),
    brief: {
      constraints: bullets([...g.constraints, ...g.nonGoals.map((n) => `Not in scope: ${n}`)]),
      dependencies: bullets(g.dependencies),
      assumptions: bullets(g.assumptions),
      validation: bullets(g.validation),
      questions: bullets(g.openQuestions),
      ...(routes.length ? { routes } : {}),
      ...(newRoutes.length ? { newRoutes } : {}),
      ...(g.lane ? { lane: g.lane } : {}),
    },
    ...(g.lane ? { grooming: { model: g.modelId, at: g.acceptedAt ?? g.groomedAt, summary: g.assistantSummary, by: 'owner' as const } } : {}),
  };
}
