import { describe, it, expect } from 'vitest';
import { verifyWorkflow, isRecurringWorkflow } from '$lib/workflows/orchestrator/verify';
import type { WorkflowNodeDef, WorkflowEdgeDef, JsonSchema, NodeDefinition } from '$lib/workflows/types';

// The B3 graph rule (recurring send without dedup memory) is independent of the
// node registry, so we stub the definition/output-schema lookups. With
// getDefinition → undefined, the per-node config/template/schema checks are
// skipped, leaving only the graph-level dedupe findings (which we isolate by
// filtering issues on field === 'dedupe').
const getDefinition = (_type: string): NodeDefinition | undefined => undefined;
const getOutputSchema = (_type: string, _config: Record<string, unknown>): JsonSchema => ({ type: 'object' });

let idCounter = 0;
function node(type: string, config: Record<string, unknown> = {}, label?: string): WorkflowNodeDef {
  const id = `${type}-${++idCounter}`;
  return { id, type, config, label: label ?? type, position: { x: 0, y: 0 } };
}
function edge(source: WorkflowNodeDef, target: WorkflowNodeDef): WorkflowEdgeDef {
  return { id: `e-${source.id}-${target.id}`, sourceNodeId: source.id, targetNodeId: target.id };
}
/** Only the graph-level "missing dedupe" findings. */
function dedupeIssues(nodes: WorkflowNodeDef[], edges: WorkflowEdgeDef[], trigger?: { type: string }) {
  return verifyWorkflow(nodes, edges, getDefinition, getOutputSchema, trigger).filter((i) => i.field === 'dedupe');
}

const CRON = { type: 'cron' as const };

describe('isRecurringWorkflow', () => {
  it('is recurring for a workflow-level cron trigger', () => {
    expect(isRecurringWorkflow([], { type: 'cron' })).toBe(true);
  });
  it('is recurring for a trigger node configured with kind=cron', () => {
    expect(isRecurringWorkflow([node('trigger', { kind: 'cron', cron: '0 7 * * *' })])).toBe(true);
  });
  it('is recurring for a trigger node with a bare cron expression', () => {
    expect(isRecurringWorkflow([node('trigger', { cron: '*/5 * * * *' })])).toBe(true);
  });
  it('is recurring when a gmail-trigger node is present', () => {
    expect(isRecurringWorkflow([node('gmail-trigger', { accountId: 1 })])).toBe(true);
  });
  it('is NOT recurring for a manual trigger', () => {
    expect(isRecurringWorkflow([node('trigger', { kind: 'manual' })], { type: 'manual' })).toBe(false);
  });
  it('is NOT recurring for a manual-trigger node with no schedule', () => {
    expect(isRecurringWorkflow([node('manual-trigger', {})])).toBe(false);
  });
});

describe('verifyWorkflow — B3 recurring send without dedup memory', () => {
  it('flags a cron → tavily → whatsapp flat chain (the live failure shape)', () => {
    const trigger = node('trigger', { kind: 'cron', cron: '0 7 * * *' });
    const tavily = node('tavily-search', { query: 'renewable energy' }, 'Search News');
    const llm = node('llm-call', { userPrompt: 'Summarise {{input.results}}' }, 'Summarise');
    const wa = node('whatsapp', { message: 'hi' }, 'Notify Me');
    const nodes = [trigger, tavily, llm, wa];
    const edges = [edge(trigger, tavily), edge(tavily, llm), edge(llm, wa)];

    const issues = dedupeIssues(nodes, edges, CRON);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].nodeId).toBe(tavily.id); // fix is anchored to the source
    expect(issues[0].issue).toContain('Search News');
    expect(issues[0].issue).toContain('Notify Me');
    expect(issues[0].issue.toLowerCase()).toContain('dedupe');
    expect(issues[0].issue).toContain('idPath');
  });

  it('demotes an ambiguous http-request source to a warning — scalar monitors are legitimate', () => {
    const trigger = node('trigger', { kind: 'cron', cron: '0 * * * *' });
    const http = node('http-request', { url: 'https://example.com/health' }, 'Health Check');
    const wa = node('whatsapp', { message: '{{input.body}}' }, 'Notify Me');
    const nodes = [trigger, http, wa];
    const edges = [edge(trigger, http), edge(http, wa)];

    const issues = dedupeIssues(nodes, edges, CRON);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning'); // must NOT burn revision rounds
    expect(issues[0].issue).toContain('single current value');
  });

  it('does NOT flag a gmail auto-reply — gmail-fetch is a single-message fetch, not a feed', () => {
    // Golden exemplars 3 & 4: gmail-trigger → gmail-fetch → llm → gmail-reply.
    // gmail-fetch pulls ONE message by id (per-message idempotent), so it must
    // not trip the dedupe rule even though the gmail-trigger makes it recurring.
    const trigger = node('gmail-trigger', { accountId: 1 });
    const full = node('gmail-fetch', { accountId: 1, messageId: '{{trigger.output.messageId}}' }, 'Fetch full');
    const draft = node('llm-call', { userPrompt: 'Draft a reply' }, 'Draft');
    const reply = node('gmail-reply', { accountId: 1, to: 'x@y.z', threadId: 't', bodyText: 'b' }, 'Reply');
    const nodes = [trigger, full, draft, reply];
    const edges = [edge(trigger, full), edge(full, draft), edge(draft, reply)];
    expect(dedupeIssues(nodes, edges)).toHaveLength(0);
  });

  it('does NOT flag the manual diff-dance — data-store on a parallel merge branch guards the send (golden exemplar 7)', () => {
    // trigger → seen(data-store get) → merge ; trigger → scrape → merge ;
    // merge → diff(transform) → email ; diff → save(data-store set).
    // The memory node sits on a PARALLEL branch feeding the merge, so the naive
    // barrier walk (source→send chain only) used to false-positive on scrape.
    const trigger = node('trigger', { kind: 'cron', cron: '0 8 * * *' });
    const seen = node('data-store', { operation: 'get', key: 'seen_job_ids' }, 'Load seen');
    const scrape = node('stealth-scrape', { url: 'https://jobs.example.com' }, 'Scrape jobs');
    const merge = node('merge', {}, 'Merge');
    const diff = node('transform', { expression: 'return { newLinks: [] }' }, 'Diff');
    const email = node('email', { to: 'me@x.z', subject: 'New jobs', body: '{{input.newLinks}}' }, 'Email');
    const save = node('data-store', { operation: 'set', key: 'seen_job_ids', valuePath: 'allLinks' }, 'Save seen');
    const nodes = [trigger, seen, scrape, merge, diff, email, save];
    const edges = [
      edge(trigger, seen), edge(trigger, scrape),
      edge(seen, merge), edge(scrape, merge),
      edge(merge, diff), edge(diff, email), edge(diff, save),
    ];
    expect(dedupeIssues(nodes, edges, CRON)).toHaveLength(0);
  });

  it('detects the schedule from a cron trigger NODE even with no workflow-level trigger', () => {
    const trigger = node('trigger', { kind: 'cron', cron: '0 7 * * *' });
    const tavily = node('tavily-search', {});
    const wa = node('whatsapp', { message: 'hi' });
    const nodes = [trigger, tavily, wa];
    const edges = [edge(trigger, tavily), edge(tavily, wa)];
    // No trigger arg passed — must still fire off the trigger node's config.
    expect(dedupeIssues(nodes, edges)).toHaveLength(1);
  });

  it('is clean when a dedupe node sits between the source and the send', () => {
    const trigger = node('trigger', { kind: 'cron', cron: '0 7 * * *' });
    const tavily = node('tavily-search', {});
    const dedupe = node('dedupe', { itemsPath: 'results', idPath: 'url' });
    const wa = node('whatsapp', { message: 'hi' });
    const nodes = [trigger, tavily, dedupe, wa];
    const edges = [edge(trigger, tavily), edge(tavily, dedupe), edge(dedupe, wa)];
    expect(dedupeIssues(nodes, edges, CRON)).toHaveLength(0);
  });

  it('is clean when a data-store node sits between the source and the send', () => {
    const trigger = node('trigger', { kind: 'cron', cron: '0 7 * * *' });
    const tavily = node('tavily-search', {});
    const store = node('data-store', { operation: 'add_to_set' });
    const wa = node('whatsapp', { message: 'hi' });
    const nodes = [trigger, tavily, store, wa];
    const edges = [edge(trigger, tavily), edge(tavily, store), edge(store, wa)];
    expect(dedupeIssues(nodes, edges, CRON)).toHaveLength(0);
  });

  it('is clean for a manual-trigger-only workflow (re-sends are expected)', () => {
    const trigger = node('trigger', { kind: 'manual' });
    const tavily = node('tavily-search', {});
    const wa = node('whatsapp', { message: 'hi' });
    const nodes = [trigger, tavily, wa];
    const edges = [edge(trigger, tavily), edge(tavily, wa)];
    expect(dedupeIssues(nodes, edges, { type: 'manual' })).toHaveLength(0);
  });

  it('is clean for a recurring workflow with a source but NO send node', () => {
    const trigger = node('trigger', { kind: 'cron', cron: '0 7 * * *' });
    const tavily = node('tavily-search', {});
    const store = node('data-store', { operation: 'set' });
    const nodes = [trigger, tavily, store];
    const edges = [edge(trigger, tavily), edge(tavily, store)];
    expect(dedupeIssues(nodes, edges, CRON)).toHaveLength(0);
  });

  it('flags a gmail-trigger → gmail-search → gmail-send chain', () => {
    const trigger = node('gmail-trigger', { accountId: 1 });
    const search = node('gmail-search', { query: 'is:unread' }, 'Find Mail');
    const send = node('gmail-send', { to: 'x@y.z' }, 'Auto-reply');
    const nodes = [trigger, search, send];
    const edges = [edge(trigger, search), edge(search, send)];
    const issues = dedupeIssues(nodes, edges);
    expect(issues).toHaveLength(1);
    expect(issues[0].nodeId).toBe(search.id);
  });

  it('flags the unguarded path when the source both bypasses and feeds a dedupe', () => {
    // tavily → dedupe → whatsapp (guarded) AND tavily → whatsapp (unguarded).
    const trigger = node('trigger', { kind: 'cron', cron: '0 7 * * *' });
    const tavily = node('tavily-search', {});
    const dedupe = node('dedupe', {});
    const wa = node('whatsapp', { message: 'hi' });
    const nodes = [trigger, tavily, dedupe, wa];
    const edges = [edge(trigger, tavily), edge(tavily, dedupe), edge(dedupe, wa), edge(tavily, wa)];
    expect(dedupeIssues(nodes, edges, CRON)).toHaveLength(1);
  });

  it('reports each unguarded source once even when it fans out to two sends', () => {
    const trigger = node('trigger', { kind: 'cron', cron: '0 7 * * *' });
    const tavily = node('tavily-search', {});
    const wa = node('whatsapp', { message: 'hi' });
    const email = node('email', { to: 'x@y.z', subject: 's', body: 'b' });
    const nodes = [trigger, tavily, wa, email];
    const edges = [edge(trigger, tavily), edge(tavily, wa), edge(tavily, email)];
    const issues = dedupeIssues(nodes, edges, CRON);
    expect(issues).toHaveLength(1);
    expect(issues[0].nodeId).toBe(tavily.id);
  });
});

/** Only the graph-level "destructive site-tool without approval" findings. */
function siteToolApprovalIssues(nodes: WorkflowNodeDef[], edges: WorkflowEdgeDef[]) {
  return verifyWorkflow(nodes, edges, getDefinition, getOutputSchema).filter(
    (i) => i.field === 'allowDestructive',
  );
}

describe('verifyWorkflow — C1 destructive site-tool needs an upstream approval node', () => {
  it('errors when a site-tool with allowDestructive:true has no approval upstream', () => {
    const trigger = node('trigger', { kind: 'manual' });
    const st = node('site-tool', { toolName: 'whatsapp_send', allowDestructive: true }, 'Send WA');
    const nodes = [trigger, st];
    const edges = [edge(trigger, st)];
    const issues = siteToolApprovalIssues(nodes, edges);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].nodeId).toBe(st.id);
    expect(issues[0].issue).toContain('whatsapp_send');
    expect(issues[0].issue.toLowerCase()).toContain('approval');
  });

  it('passes when an approval node sits upstream (directly or transitively)', () => {
    const trigger = node('trigger', { kind: 'manual' });
    const approval = node('approval', {}, 'Sign off');
    const transform = node('transform', {}, 'Prep');
    const st = node('site-tool', { toolName: 'publish_page', allowDestructive: true }, 'Publish');
    const nodes = [trigger, approval, transform, st];
    // trigger → approval → transform → site-tool (approval is transitively upstream)
    const edges = [edge(trigger, approval), edge(approval, transform), edge(transform, st)];
    expect(siteToolApprovalIssues(nodes, edges)).toHaveLength(0);
  });

  it('does not flag a non-destructive site-tool (allowDestructive falsy)', () => {
    const trigger = node('trigger', { kind: 'manual' });
    const st = node('site-tool', { toolName: 'save_memory' }, 'Remember');
    expect(siteToolApprovalIssues([trigger, st], [edge(trigger, st)])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// E: fan-in whose branches overwrite each other
//
// Upstream inputs are merged FLAT, so two branches emitting the same top-level
// key mean one is discarded before the target node runs. This is what broke
// daily-spend-summary on 2026-08-02 and it surfaced three nodes later as an
// unrelated HTTP 404 — precisely the class of thing the linter should catch
// before a run, not after.
// ---------------------------------------------------------------------------

/** Every api-call emits the same keys — that identity is the whole problem. */
const API_CALL_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { success: {}, api: {}, status: {}, url: {}, json: {} },
};
const fanInSchema = (type: string, config: Record<string, unknown>): JsonSchema => {
  const configured = config?.outputSchema;
  if (configured && typeof configured === 'object') {
    return { type: 'object', properties: configured as Record<string, JsonSchema> };
  }
  return type === 'api-call' ? API_CALL_SCHEMA : { type: 'object', properties: {} };
};

/** Only the graph-level fan-in findings. */
function fanInIssues(nodes: WorkflowNodeDef[], edges: WorkflowEdgeDef[]) {
  return verifyWorkflow(nodes, edges, getDefinition, fanInSchema).filter((i) =>
    i.issue.includes('merged flat'),
  );
}

describe('E: fan-in collision', () => {
  it('warns when two api-call branches converge on one node', () => {
    const a = node('api-call', {}, 'Get accounts');
    const b = node('api-call', {}, 'Get cards');
    const t = node('transform', {}, 'Extract IDs + dates');
    const found = fanInIssues([a, b, t], [edge(a, t), edge(b, t)]);
    expect(found).toHaveLength(1);
    expect(found[0].nodeLabel).toBe('Extract IDs + dates');
    expect(found[0].severity).toBe('warning');
    expect(found[0].field).toContain('json');
    expect(found[0].issue).toContain('Get accounts');
    expect(found[0].issue).toContain('Get cards');
  });

  it('goes quiet once each branch is given its own key', () => {
    const a = node('api-call', {}, 'Get accounts');
    const b = node('api-call', {}, 'Get cards');
    const la = node('transform', { outputSchema: { accounts: {} } }, 'Label accounts');
    const lb = node('transform', { outputSchema: { cards: {} } }, 'Label cards');
    const t = node('transform', {}, 'Extract IDs + dates');
    expect(
      fanInIssues([a, b, la, lb, t], [edge(a, la), edge(b, lb), edge(la, t), edge(lb, t)]),
    ).toEqual([]);
  });

  it('does not warn on a single upstream', () => {
    const a = node('api-call', {}, 'Get accounts');
    const t = node('transform', {}, 'Next');
    expect(fanInIssues([a, t], [edge(a, t)])).toEqual([]);
  });
});
