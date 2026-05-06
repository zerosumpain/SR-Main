/**
 * Client for the jkai-builder sidecar. Replaces the in-process orchestrator
 * import everywhere in the SvelteKit web app — every build-control route
 * goes over the Unix socket so the builder is the single owner of in-memory
 * build state. Deploys of the SvelteKit web app no longer kill in-flight
 * builds (the builder service has its own systemd unit, Restart=always).
 *
 * Wire format mirrors packages/jkai-builder/src/rpc.ts:
 *   POST /rpc {method, args}  → {ok: true, result} | {ok: false, error}
 *
 * Errors from the builder come back as {ok: false, error}. We surface them
 * as thrown Error so route handlers don't need to special-case the wire shape.
 */
import { request as httpRequest } from 'node:http';

const SOCKET_PATH =
  process.env.JKAI_BUILDER_SOCKET ?? '/run/jkai-builder/jkai-builder.sock';

function rpc<T = unknown>(method: string, args: unknown[]): Promise<T> {
  const body = JSON.stringify({ method, args });
  return new Promise<T>((resolve, reject) => {
    const req = httpRequest(
      {
        socketPath: SOCKET_PATH,
        method: 'POST',
        path: '/rpc',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
        timeout: 30_000,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf-8');
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let parsed: { ok?: boolean; result?: unknown; error?: string };
          try { parsed = JSON.parse(raw); } catch (e) {
            reject(new Error(`builder rpc ${method}: invalid response body: ${raw.slice(0, 200)}`));
            return;
          }
          if (parsed.ok) resolve(parsed.result as T);
          else reject(new Error(`builder rpc ${method}: ${parsed.error ?? 'unknown error'}`));
        });
      },
    );
    req.on('error', (err) => reject(new Error(`builder rpc ${method}: socket error: ${err.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error(`builder rpc ${method}: timed out after 30s`)); });
    req.write(body);
    req.end();
  });
}

/**
 * Surface that mirrors the public methods of `Orchestrator` in
 * src/lib/jkai/orchestrator.ts — same names, same arg shapes, just dispatched
 * over the Unix socket instead of called in-process.
 */
export const builderClient = {
  startBuild: (buildId: string) => rpc<void>('startBuild', [buildId]),
  pauseBuild: (buildId: string) => rpc<void>('pauseBuild', [buildId]),
  resumeBuild: (buildId: string) => rpc<void>('resumeBuild', [buildId]),
  restartBuild: (buildId: string) => rpc<void>('restartBuild', [buildId]),
  stopBuild: (buildId: string) => rpc<void>('stopBuild', [buildId]),
  continueBuild: (buildId: string, prompt: string, modelOverride?: { provider?: string; modelId?: string }) =>
    rpc<void>('continueBuild', [buildId, prompt, modelOverride]),
  extendDeadline: (buildId: string, additionalMs: number) => rpc<number | null>('extendDeadline', [buildId, additionalMs]),
  approvePlan: (buildId: string) => rpc<void>('approvePlan', [buildId]),
  skipPlan: (buildId: string) => rpc<void>('skipPlan', [buildId]),
  replan: (buildId: string, revisedPrompt?: string) => rpc<void>('replan', [buildId, revisedPrompt]),
  editPlan: (buildId: string, plan: string) => rpc<void>('editPlan', [buildId, plan]),
  approveIteration: (buildId: string) => rpc<void>('approveIteration', [buildId]),
  rejectIteration: (buildId: string, notes: string) => rpc<void>('rejectIteration', [buildId, notes]),
  cancelQueued: (buildId: string) => rpc<void>('cancelQueued', [buildId]),

  // Phase 5/6/7 session actions.
  sessionInject: (buildId: string, content: string) => rpc<void>('sessionInject', [buildId, content]),
  sessionInjectRemove: (buildId: string, id: number) => rpc<void>('sessionInjectRemove', [buildId, id]),
  sessionInterrupt: (buildId: string) => rpc<{ ok: boolean }>('sessionInterrupt', [buildId]),
  sessionAddNote: (buildId: string, content: string) => rpc<void>('sessionAddNote', [buildId, content]),
  sessionRemoveNote: (buildId: string, id: number) => rpc<void>('sessionRemoveNote', [buildId, id]),
  sessionShell: (buildId: string, command: string) => rpc<void>('sessionShell', [buildId, command]),
  sessionSnapshot: (buildId: string) => rpc<{ queue: unknown[]; notes: unknown[] }>('sessionSnapshot', [buildId]),
};

export const BUILDER_SOCKET_PATH = SOCKET_PATH;
