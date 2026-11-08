/**
 * Every request the site makes to Tavily, one ledger row each.
 *
 * The research page shows the account's monthly credit meter (`GET /usage`,
 * `$lib/deepdive/tavily-usage`), and that number only ever says HOW MUCH. It
 * cannot say what spent it: Tavily keeps no per-request history we can read
 * back, and the per-run counters on `research_session` only see calls made
 * inside a research run. Workflow nodes, page summaries, Keep-in-Drive and
 * the chat tool all spent credits that nothing attributed.
 *
 * So the request is written down at the only moment it is knowable — when it
 * returns — with what was asked, which code asked, and whatever the ambient
 * contexts say about why (research run, workflow run and node, chat turn,
 * LLM workload). /admin/ops/tavily reads it back.
 *
 * Rows go into `agent_actions` as `action_type = 'tavily_call'` rather than a
 * table of their own. Main and Workflows can both already write there, so no
 * schema push and no runtime-role grant is needed, and every cost reader
 * filters on `action_type = 'llm_call'` (ledger.test.ts holds that line), so a
 * credit row cannot leak into a cash total. Credits live in `input`, never in
 * `cost_usd`: they are an allowance, not money.
 *
 * Brave Search requests, which the search balancer (`./web-search`) sends
 * some of the site's searches to, are written the same way under
 * `action_type = 'brave_call'`: one ledger for both providers, read back
 * together on the same page. A Brave request costs one request of the plan's
 * allowance, so its `credits` is 1.
 *
 * This file is copied into SR-Workflows. The copies differ only in `APP`.
 */
import { hostname } from 'node:os';
import { db } from '$lib/db';
import { agentActions } from '$lib/db/schema';
import { currentActivityId } from '$lib/context/activity';
import { currentChatContext } from '$lib/context/chat';
import { executionContext } from '$lib/context/execution';
import { currentResearchSessionId, type TavilyDepth } from '$lib/context/research-meter';

export const TAVILY_ACTION = 'tavily_call';
export const BRAVE_ACTION = 'brave_call';

export type SearchProvider = 'tavily' | 'brave';

const ACTION: Record<SearchProvider, string> = { tavily: TAVILY_ACTION, brave: BRAVE_ACTION };

/** Which application made the call. The only line that differs between the copies. */
const APP = 'main';

const MAX_QUERY_CHARS = 500;
const MAX_URLS_KEPT = 10;
const MAX_URL_CHARS = 300;
const MAX_ERROR_CHARS = 400;

/** A provider's own reading of its allowance, from the response that carried it. */
export interface SearchQuota {
  limit: number | null;
  remaining: number | null;
  /** Seconds until the allowance resets, as the provider stated it. */
  resetSeconds: number | null;
}

export interface TavilyCall {
  /** Which search API answered. Absent means Tavily, which every caller before the balancer was. */
  provider?: SearchProvider;
  kind: 'search' | 'extract';
  /**
   * The code path that made the request, in `area.step` form
   * (`research.phase1`, `workflow.tavily-search`, `tool.tavily_search`).
   * Required at every call site so a new caller cannot arrive unlabelled.
   */
  purpose: string;
  depth: TavilyDepth;
  query?: string;
  urls?: string[];
  /** Request options worth seeing when judging a call: max results, topic, domains. */
  options?: Record<string, unknown>;
  /** Credits this request was billed, by the published model. 0 for a refused request. */
  credits: number;
  ok: boolean;
  httpStatus?: number | null;
  error?: string | null;
  durationMs: number;
  resultCount?: number | null;
  /** 1 for the first try, 2 for a retry or a failover. Each attempt is its own request. */
  attempt: number;
  /** Brave only: the monthly allowance its rate-limit headers reported on this response. */
  quota?: SearchQuota | null;
}

/** Why the call happened, read from the contexts already carried for the LLM ledger. */
export interface TavilyAmbient {
  researchSessionId: string | null;
  workflowId: string | null;
  runId: string | null;
  nodeId: string | null;
  activity: string | null;
  conversationId: string | null;
  jobId: string | null;
}

export function readAmbient(): TavilyAmbient {
  const node = executionContext.getStore();
  const chat = currentChatContext();
  return {
    researchSessionId: currentResearchSessionId(),
    workflowId: node?.workflowId ?? null,
    runId: node?.runId ?? null,
    nodeId: node?.nodeId ?? null,
    activity: currentActivityId(),
    conversationId: chat?.conversationId ?? null,
    jobId: chat?.jobId ?? null,
  };
}

/**
 * Tavily keys look like `tvly-…` and Brave's like `BSA…`; an error body or a
 * pasted query must never carry one into the ledger.
 */
function scrub(text: string, max: number): string {
  return text
    .replace(/tvly-[A-Za-z0-9_-]+/g, 'tvly-[redacted]')
    .replace(/\bBSA[A-Za-z0-9_-]{16,}/g, 'BSA[redacted]')
    .slice(0, max);
}

let host: string | null = null;
function hostName(): string {
  if (host === null) {
    try {
      host = hostname();
    } catch {
      host = 'unknown';
    }
  }
  return host;
}

/** The `agent_actions` columns one search-provider request writes. */
export function tavilyCallRow(call: TavilyCall, ambient: TavilyAmbient = readAmbient()) {
  const provider: SearchProvider = call.provider ?? 'tavily';
  const input: Record<string, unknown> = {
    app: APP,
    host: hostName(),
    purpose: call.purpose,
    depth: call.depth,
    credits: call.ok ? call.credits : 0,
    attempt: call.attempt,
  };
  if (call.query !== undefined) input.query = scrub(call.query, MAX_QUERY_CHARS);
  if (call.urls) {
    input.urlCount = call.urls.length;
    input.urls = call.urls.slice(0, MAX_URLS_KEPT).map((u) => scrub(u, MAX_URL_CHARS));
  }
  if (call.options && Object.keys(call.options).length) input.options = call.options;
  if (typeof call.httpStatus === 'number') input.httpStatus = call.httpStatus;
  if (typeof call.resultCount === 'number') input.resultCount = call.resultCount;
  if (call.quota) input.quota = call.quota;
  for (const [key, value] of Object.entries(ambient)) {
    if (value) input[key] = value;
  }

  return {
    actionType: ACTION[provider],
    provider,
    toolName: call.kind,
    // The one id a reader most wants to join on: the research run, else the
    // workflow run, else the chat job. The rest stay in `input`.
    sessionId: ambient.researchSessionId ?? ambient.runId ?? ambient.jobId ?? null,
    durationMs: Math.max(0, Math.round(call.durationMs)),
    status: call.ok ? 'completed' : 'failed',
    error: call.ok || !call.error ? null : scrub(call.error, MAX_ERROR_CHARS),
    input,
  };
}

/**
 * Write one row. Fire-and-forget: a ledger outage must never fail the search
 * it describes, and the insert must not hold up the caller.
 */
export function recordTavilyCall(call: TavilyCall): void {
  let pending: Promise<unknown>;
  try {
    pending = db.insert(agentActions).values(tavilyCallRow(call));
  } catch (err) {
    pending = Promise.reject(err);
  }
  pending.catch((err: unknown) => {
    console.error('[tavily-ledger] failed to record call:', err instanceof Error ? err.message : err);
  });
}
