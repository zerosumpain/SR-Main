/**
 * The per-turn context route: what a chat turn is ABOUT, and therefore which
 * slices of memory, graph and integrations it may be shown.
 *
 * Why this exists. Every turn used to run four retrievals against the raw
 * message text and hand the model whatever came back, as a user-role message
 * ahead of the history. On "Shit bra" (2026-09-23) that was a Rome flight
 * booking, five three-letter acronyms from the graph, the twelve largest
 * clusters and a PayPal API contract — and the reply was "Yeah, that context
 * dump was a bit much", because the model read the block as something the user
 * had sent. Nothing asked whether the turn needed personal context at all, and
 * a follow-up like "reorganise it then" was retrieved on its own words, with
 * no idea what "it" was.
 *
 * The route is decided by a small model call (see `context-route.server.ts`)
 * over the message, the last few turns and the graph's own vocabulary — the
 * live cluster roster. It names the turn's kind, its domains, the entities it
 * is about and a standalone retrieval query. `planContext` then turns that into
 * the retrieval plan, deterministically, so what each kind of turn receives is
 * a rule in one place rather than a judgement spread over four fetchers.
 *
 * Pure — no I/O — so the rules are tested without a model or a database.
 */

/**
 * `casual` — banter, reactions, greetings. `meta` — about the assistant, this
 * conversation or its own workings ("what context dump", "reorganise it").
 * `task` — anything that needs knowledge or action.
 */
export type TurnKind = 'casual' | 'meta' | 'task';

/**
 * The domains a turn can touch. Deliberately coarse: they decide which
 * retrievals run, not what the answer says, and a finer split would only give
 * the router more ways to be wrong.
 */
export const CONTEXT_DOMAINS = [
  'travel', 'health', 'finance', 'work', 'home', 'calendar', 'people', 'projects', 'coding', 'graph',
] as const;
export type ContextDomain = (typeof CONTEXT_DOMAINS)[number];

/**
 * The words a message must actually contain before the whole roster is sent.
 *
 * The router alone is not trusted with this: on the production eval it tagged
 * "how many viewers have each of those had?" (a blog-stats follow-up) as a
 * graph question. The roster is the one block that is never relevant by
 * accident, so the user has to have asked for it in so many words.
 */
const GRAPH_WORDS = /\b(graph|clusters?|entit(?:y|ies)|intel|knowledge base|connections?)\b/i;

/** Domains whose answers live in the knowledge graph rather than a live tool. */
const GRAPH_DOMAINS: ReadonlySet<ContextDomain> = new Set(['work', 'people', 'projects']);

export interface ContextRoute {
  kind: TurnKind;
  domains: ContextDomain[];
  /** Names the turn is about, as written or implied by the thread — resolved against the graph later. */
  entities: string[];
  /** Roster labels the turn is about, copied from the list the router was given. */
  clusters: string[];
  /** A standalone retrieval query, with pronouns resolved from the thread. Empty for casual/meta. */
  query: string;
  /** `router` — the model decided. `fallback` — it timed out, failed or was skipped. */
  source: 'router' | 'fallback';
}

export interface ContextPlan {
  /** `pinned` — only memories the owner pinned (stable preferences). `relevant` — ranked on the query. */
  memory: 'pinned' | 'relevant';
  /**
   * `none` — no graph block. `anchored` — the named entities' own neighbourhoods
   * and only their clusters. `search` — vector search on the query, no roster.
   * `overview` — the turn is about the graph itself, so the roster too.
   */
  graph: 'none' | 'anchored' | 'search' | 'overview';
  integrations: boolean;
  /** What the retrievals search on. */
  query: string;
}

export function planContext(route: ContextRoute, message: string): ContextPlan {
  if (route.kind !== 'task') return { memory: 'pinned', graph: 'none', integrations: false, query: '' };
  const query = route.query.trim() || message.trim();
  // A fallback route knows nothing about the turn's domains, so it searches;
  // a router that named no graph-shaped domain and no entity is trusted.
  const graph: ContextPlan['graph'] = route.domains.includes('graph') && GRAPH_WORDS.test(message)
    ? 'overview'
    : route.entities.length || route.clusters.length
      ? 'anchored'
      : route.source === 'fallback' || route.domains.some((d) => GRAPH_DOMAINS.has(d) || d === 'graph')
        ? 'search'
        : 'none';
  return { memory: 'relevant', graph, integrations: true, query };
}

/**
 * The route used when the router cannot answer — a timeout, a provider error,
 * unparseable output, or a sub-agent turn that skips it.
 *
 * Errs toward retrieval, since a missing fact is worse than a noisy one on a
 * real question, but never toward the roster: plain vector search on the
 * message, as before, minus the twelve clusters nobody asked for. The one
 * exception is a message too short to carry a subject, which gets what a
 * casual turn gets — the case that started this.
 */
export function fallbackRoute(message: string): ContextRoute {
  const words = message.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 2 && !message.includes('?')) {
    return { kind: 'casual', domains: [], entities: [], clusters: [], query: '', source: 'fallback' };
  }
  return { kind: 'task', domains: [], entities: [], clusters: [], query: message.trim(), source: 'fallback' };
}

const MAX_ENTITIES = 5;
const MAX_QUERY_CHARS = 300;

/**
 * Read the router's JSON, keeping only values it was allowed to produce.
 *
 * Returns null when the output is not a usable route, so the caller falls back
 * rather than guessing. Clusters are matched against the roster it was shown —
 * an invented label must not reach the retrieval as if it were a real one.
 */
export function parseRoute(raw: string, rosterLabels: readonly string[]): ContextRoute | null {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  // A small model sometimes puts the domain where the kind goes — seen as
  // `"kind":"graph"` on "what clusters are in my knowledge graph?". That is a
  // task in that domain, and says so unambiguously.
  const kindAsDomain = typeof o.kind === 'string' && (CONTEXT_DOMAINS as readonly string[]).includes(o.kind) ? o.kind : null;
  if (o.kind !== 'casual' && o.kind !== 'meta' && o.kind !== 'task' && !kindAsDomain) return null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : []);
  const byLower = new Map(rosterLabels.map((l) => [l.toLowerCase(), l]));
  return {
    kind: kindAsDomain ? 'task' : (o.kind as TurnKind),
    domains: [...new Set([...(kindAsDomain ? [kindAsDomain] : []), ...strings(o.domains).map((d) => d.toLowerCase())])].filter((d): d is ContextDomain => (CONTEXT_DOMAINS as readonly string[]).includes(d)),
    entities: [...new Set(strings(o.entities))].slice(0, MAX_ENTITIES),
    clusters: [...new Set(strings(o.clusters).map((c) => byLower.get(c.toLowerCase())).filter((c): c is string => !!c))],
    query: typeof o.query === 'string' ? o.query.trim().slice(0, MAX_QUERY_CHARS) : '',
    source: 'router',
  };
}

/** How much of each recent turn the router sees. Enough to resolve "it", no more. */
const HISTORY_TURNS = 4;
const HISTORY_CHARS = 280;

export const ROUTER_SYSTEM = `You route context for a personal assistant. Before each reply, decide what the user's latest message is about so only relevant personal context is retrieved. Return JSON only:
{"kind":"casual"|"meta"|"task","domains":[...],"entities":[...],"clusters":[...],"query":"..."}

kind — exactly one of these three:
- "casual": banter, reactions, greetings, thanks, swearing, small talk.
- "meta": about the assistant's own replies or behaviour in this conversation, or the context it was given ("what context dump", "reorganise the context you got", "why did you say that"). Questions about the user's own data, memories or knowledge graph are "task", not "meta".
- "task": anything needing knowledge, memory or action.

domains: any of ${CONTEXT_DOMAINS.join(', ')}. Use "graph" only when the message explicitly mentions the knowledge graph, its clusters or its entities — never for questions about data, statistics, analytics or counts. Empty for casual/meta.
entities: specific named people, organisations, projects, places, products or systems the message is about — resolve pronouns from the recent turns. Never generic words.
clusters: labels copied exactly from the cluster list below, only when the message is plainly about one. Usually empty.
query: the message rewritten as a standalone search query with pronouns resolved. Empty for casual/meta.

Examples:
"cheers" → {"kind":"casual","domains":[],"entities":[],"clusters":[],"query":""}
"why did you bring up PayPal?" → {"kind":"meta","domains":[],"entities":[],"clusters":[],"query":""}
"what clusters are in my knowledge graph?" → {"kind":"task","domains":["graph"],"entities":[],"clusters":[],"query":"clusters in the knowledge graph"}
"how many views did those posts get?" → {"kind":"task","domains":["projects"],"entities":[],"clusters":[],"query":"view counts for the recent blog posts"}`;

export function renderRouterInput(
  message: string,
  history: ReadonlyArray<{ role: string; content: string }>,
  rosterLabels: readonly string[],
): string {
  const recent = history
    .filter((h) => h.role === 'user' || h.role === 'assistant')
    .slice(-HISTORY_TURNS)
    .map((h) => `${h.role}: ${h.content.replace(/\s+/g, ' ').slice(0, HISTORY_CHARS)}`)
    .join('\n');
  return `Clusters: ${rosterLabels.join('; ') || '(none)'}\n\nRecent turns:\n${recent || '(none)'}\n\nLatest message: ${message.slice(0, 2000)}`;
}
