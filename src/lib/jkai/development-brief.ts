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
  'policy-analysis': /\bpolicy[\s-]analysis\b/i,
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
