import { describe, it, expect } from 'vitest';
import { fallbackRoute, parseRoute, planContext, renderRouterInput, type ContextRoute } from './context-route';

const ROSTER = ['Scheduler / Steampunk workshop', 'PayPal / NatWest', 'IBCA Data Strategy / David Foley'];

function route(over: Partial<ContextRoute>): ContextRoute {
  return { kind: 'task', domains: [], entities: [], clusters: [], query: '', capabilities: [], source: 'router', ...over };
}

describe('planContext', () => {
  // The turn that started this: a two-word reaction was served a flight
  // booking, graph acronyms, twelve clusters and a PayPal contract.
  it.each(['casual', 'meta'] as const)('gives a %s turn pinned memory and nothing else', (kind) => {
    expect(planContext(route({ kind, domains: ['finance'], entities: ['PayPal'] }), 'Shit bra')).toEqual({
      memory: 'pinned', graph: 'none', integrations: false, query: '', toolGroups: [], skills: false,
    });
  });

  it('anchors a task on the entities it names, and never sends the roster for it', () => {
    const plan = planContext(route({ entities: ['David Foley'], domains: ['people'], query: 'who is David Foley' }), "who's David Foley");
    expect(plan.graph).toBe('anchored');
    expect(plan.query).toBe('who is David Foley');
  });

  it('sends the roster only when the turn is about the graph itself', () => {
    expect(planContext(route({ domains: ['graph'] }), 'what clusters do I have').graph).toBe('overview');
    expect(planContext(route({ domains: ['projects'] }), 'what am I working on').graph).toBe('search');
  });

  it('does not take the router\'s word for a graph question the message never asked', () => {
    // Production eval: a blog-stats follow-up came back tagged `graph`.
    expect(planContext(route({ domains: ['graph'], query: 'viewer counts for the last 3 blog posts' }), 'how many viewers have each of those had?').graph).toBe('search');
  });

  it('leaves the graph out of a task a live tool answers', () => {
    // Sleep, the calendar, the rail board: the graph adds nothing a domain tool
    // does not, and the router has said the turn names nothing.
    expect(planContext(route({ domains: ['health'], query: 'sleep last night' }), 'how did I sleep').graph).toBe('none');
    expect(planContext(route({ domains: ['travel'], query: 'next train to Newcastle' }), 'next train?').graph).toBe('none');
  });

  it('searches on the rewritten query, falling back to the message', () => {
    expect(planContext(route({ query: 'Rome trip flight times' }), 'when do we fly').query).toBe('Rome trip flight times');
    expect(planContext(route({ query: '' }), 'when do we fly').query).toBe('when do we fly');
  });

  it('lets a fallback task search, since it knows nothing of the domains', () => {
    expect(planContext(fallbackRoute('what did the IBCA email say about the data strategy?'), 'x').graph).toBe('search');
  });
});

describe('tool groups and skills', () => {
  it('loads only the rare tool groups the router asked for', () => {
    expect(planContext(route({ capabilities: ['schedule'] }), 'remind me at 9').toolGroups).toEqual(['schedule']);
    expect(planContext(route({}), 'what is the weather').toolGroups).toEqual([]);
  });

  it('keeps every tool on a turn nobody classified', () => {
    // A router timeout must not quietly take a tool away from a real request.
    expect(planContext(fallbackRoute('set up a reminder for the bins every Tuesday'), 'x').toolGroups).toBe('all');
    expect(planContext(fallbackRoute('yup'), 'yup').toolGroups).toBe('all');
  });

  it('honours a capability even on a turn that reads as casual', () => {
    // "yes please" agreeing to a reminder is short, but it still needs the tool.
    expect(planContext(route({ kind: 'casual', capabilities: ['schedule'] }), 'yes please').toolGroups).toEqual(['schedule']);
  });

  it('sends the skills index only to tasks and to unclassified turns', () => {
    expect(planContext(route({ kind: 'casual' }), 'Sup dog').skills).toBe(false);
    expect(planContext(route({ kind: 'meta' }), 'why did you say that').skills).toBe(false);
    expect(planContext(route({}), 'build me a deck').skills).toBe(true);
    expect(planContext(fallbackRoute('build me a deck about the data spine'), 'x').skills).toBe(true);
  });
});

describe('fallbackRoute', () => {
  it('treats a two-word reaction as casual', () => {
    expect(fallbackRoute('Shit bra').kind).toBe('casual');
    expect(fallbackRoute('  yup  ').kind).toBe('casual');
  });

  it('treats a question or a longer message as a task on its own words', () => {
    expect(fallbackRoute('Rome flights?')).toMatchObject({ kind: 'task', query: 'Rome flights?', source: 'fallback' });
    expect(fallbackRoute('tell me about the data spine').kind).toBe('task');
  });
});

describe('parseRoute', () => {
  it('reads a well-formed route', () => {
    const r = parseRoute('{"kind":"task","domains":["travel","Calendar"],"entities":["Rome"],"clusters":[],"query":"Rome flights"}', ROSTER);
    expect(r).toEqual({ kind: 'task', domains: ['travel', 'calendar'], entities: ['Rome'], clusters: [], query: 'Rome flights', capabilities: [], source: 'router' });
  });

  it('accepts a fenced block', () => {
    expect(parseRoute('```json\n{"kind":"casual"}\n```', ROSTER)?.kind).toBe('casual');
  });

  it('drops domains outside the vocabulary and clusters not on the roster', () => {
    // An invented cluster label must not reach retrieval as if it were real.
    const r = parseRoute('{"kind":"task","domains":["gossip","finance"],"clusters":["paypal / natwest","Made Up"]}', ROSTER);
    expect(r?.domains).toEqual(['finance']);
    expect(r?.clusters).toEqual(['PayPal / NatWest']);
  });

  it('reads a domain given as the kind as a task in that domain', () => {
    // Seen from the production router on "what clusters are in my knowledge graph?".
    expect(parseRoute('{"kind":"graph","domains":[],"query":"clusters"}', ROSTER)).toMatchObject({ kind: 'task', domains: ['graph'] });
  });

  it('returns null rather than guessing', () => {
    expect(parseRoute('not json', ROSTER)).toBeNull();
    expect(parseRoute('{"kind":"chitchat"}', ROSTER)).toBeNull();
    expect(parseRoute('[]', ROSTER)).toBeNull();
  });

  it('keeps only known capabilities', () => {
    expect(parseRoute('{"kind":"task","capabilities":["Schedule","teleport","build-tool"]}', ROSTER)?.capabilities).toEqual(['schedule', 'build-tool']);
    expect(parseRoute('{"kind":"task"}', ROSTER)?.capabilities).toEqual([]);
  });

  it('caps entities and the query', () => {
    const r = parseRoute(JSON.stringify({ kind: 'task', entities: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], query: 'x'.repeat(900) }), ROSTER);
    expect(r?.entities).toHaveLength(5);
    expect(r?.query.length).toBe(300);
  });
});

describe('renderRouterInput', () => {
  it('gives the router the roster and only the last few turns, trimmed', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i} ` + 'x'.repeat(500) }));
    const input = renderRouterInput('reorganise it then', history, ROSTER);
    expect(input).toContain('PayPal / NatWest');
    expect(input).not.toContain('turn 5');
    expect(input).toContain('turn 9');
    expect(input).toContain('Latest message: reorganise it then');
    expect(input.length).toBeLessThan(2000);
  });
});
