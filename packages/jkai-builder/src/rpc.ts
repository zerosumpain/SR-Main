/**
 * Unix-socket JSON-RPC for the jkai builder.
 *
 * The SvelteKit web app proxies build-control routes to this dispatcher
 * (see src/lib/jkai/builder-client.ts). All authoritative orchestrator
 * state lives in this process now — SvelteKit no longer holds a copy.
 *
 * Wire format: POST /rpc with JSON body { method, args }. Response is
 * { ok: true, result } on success or { ok: false, error } on failure.
 * Errors are returned with HTTP 200 and an `ok: false` flag — easier
 * to debug from the client side than non-standard HTTP statuses.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { orchestrator } from '$lib/jkai/orchestrator';

type AnyArgs = unknown[];

// Dispatch table — every call site in SvelteKit must come through one of these.
const dispatchTable: Record<string, (args: AnyArgs) => Promise<unknown> | unknown> = {
  startBuild: (a) => orchestrator.startBuild(a[0] as string),
  pauseBuild: (a) => orchestrator.pauseBuild(a[0] as string),
  resumeBuild: (a) => orchestrator.resumeBuild(a[0] as string),
  restartBuild: (a) => orchestrator.restartBuild(a[0] as string),
  stopBuild: (a) => orchestrator.stopBuild(a[0] as string),
  continueBuild: (a) => orchestrator.continueBuild(a[0] as string, a[1] as string, a[2] as { provider?: string; modelId?: string } | undefined),
  extendDeadline: (a) => orchestrator.extendDeadline(a[0] as string, a[1] as number),
  approvePlan: (a) => orchestrator.approvePlan(a[0] as string),
  skipPlan: (a) => orchestrator.skipPlan(a[0] as string),
  replan: (a) => orchestrator.replan(a[0] as string, a[1] as string | undefined),
  editPlan: (a) => orchestrator.editPlan(a[0] as string, a[1] as string),
  approveIteration: (a) => orchestrator.approveIteration(a[0] as string),
  rejectIteration: (a) => orchestrator.rejectIteration(a[0] as string, a[1] as string),
};

export type RpcMethod = keyof typeof dispatchTable;

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.setEncoding('utf-8');
    req.on('data', (c) => { buf += c; });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export async function handleRpc(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  let raw = '';
  try { raw = await readBody(req); } catch (e) {
    send(res, 400, { ok: false, error: `read body: ${(e as Error).message}` });
    return;
  }
  let parsed: { method?: unknown; args?: unknown };
  try { parsed = JSON.parse(raw); } catch (e) {
    send(res, 400, { ok: false, error: `invalid json: ${(e as Error).message}` });
    return;
  }
  const method = typeof parsed.method === 'string' ? parsed.method : '';
  const args = Array.isArray(parsed.args) ? parsed.args : [];
  const fn = dispatchTable[method];
  if (!fn) {
    send(res, 200, { ok: false, error: `unknown method: ${method}` });
    return;
  }
  try {
    const result = await fn(args);
    send(res, 200, { ok: true, result: result ?? null });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error(`[jkai-builder] rpc ${method} failed:`, err);
    send(res, 200, { ok: false, error: err });
  }
}
