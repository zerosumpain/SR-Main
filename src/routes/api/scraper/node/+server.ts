/**
 * POST /api/scraper/node — execute a stealth-scrape node call on homeserv.
 *
 * Other side of the outer-guard in `stealthScrapeExecutor.execute`: when the
 * VPS picks up a stealth-scrape node, it forwards (input, config, runId,
 * nodeId, workflowId) here. We instantiate a minimal ExecutionContext with a
 * buffered `emit` (events are returned in the response so the VPS can re-emit
 * onto its own bus), call the executor locally on homeserv, and return the
 * NodeResult plus buffered events.
 *
 * Auth + host guard via `assertScraperServiceRequest` — same pattern as
 * /api/scraper/run and /api/scraper/script. Refuses on non-homeserv hosts to
 * stop a misconfigured proxy chain looping back to the VPS.
 */
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { stealthScrapeExecutor } from '$lib/workflows/nodes/stealth-scrape';
import { assertScraperServiceRequest } from '$lib/workflows/scraper/service-auth';
import type { ExecutionContext, WorkflowEvent, NodeResult } from '$lib/workflows/types';

interface ProxyRequest {
  input: Record<string, unknown>;
  config: Record<string, unknown>;
  runId: string;
  nodeId: string;
  workflowId?: string;
  workspaceDir?: string;
  dryRun?: boolean;
}

export interface ProxyResponse {
  result: NodeResult;
  events: WorkflowEvent[];
}

export const POST: RequestHandler = async ({ request }) => {
  assertScraperServiceRequest(request);
  const body = (await request.json().catch(() => ({}))) as Partial<ProxyRequest>;
  if (!body.input || typeof body.input !== 'object') throw error(400, 'input is required');
  if (!body.config || typeof body.config !== 'object') throw error(400, 'config is required');
  if (!body.runId) throw error(400, 'runId is required');
  if (!body.nodeId) throw error(400, 'nodeId is required');

  const events: WorkflowEvent[] = [];
  const context: ExecutionContext = {
    runId: body.runId,
    workflowId: body.workflowId ?? body.runId,
    workspaceDir: body.workspaceDir ?? `/tmp/workflow-${body.runId}`,
    dryRun: body.dryRun ?? false,
    emit: (event) => { events.push(event); },
    getNodeOutput: () => undefined,
    checkBreakpoint: async () => {},
    abortSignal: new AbortController().signal,
    getOutgoingEdges: () => [],
    getNodeConfig: () => undefined,
    // _currentNodeId is read by stealth-scrape but isn't on the public type
    _currentNodeId: body.nodeId,
  } as ExecutionContext & { _currentNodeId: string };

  const result = await stealthScrapeExecutor.execute(body.input, body.config, context);
  return json({ result, events } satisfies ProxyResponse);
};
