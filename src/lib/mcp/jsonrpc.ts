// MCP Streamable HTTP transport — JSON-RPC dispatcher.
//
// Hermes' MCP client (Python `mcp` SDK) speaks the Streamable HTTP transport
// from the MCP spec, not our previous bespoke {name, arguments} POST shape.
// The protocol is JSON-RPC 2.0 over HTTP:
//
//   POST /api/mcp   body { jsonrpc: "2.0", id, method, params }
//
// This module owns the wire-format dispatch. The SvelteKit route at
// src/routes/api/mcp/+server.ts adapts SvelteKit's Request/Response to
// dispatchJsonRpc(); keeping the logic here means we can unit-test the full
// initialize / tools/list / tools/call lifecycle without booting Vite.
//
// Stateless mode: we don't issue an `Mcp-Session-Id`, don't track sessions,
// and don't open server-initiated SSE streams. Each POST is self-contained.

import { timingSafeEqual } from 'node:crypto';
import { listMcpTools } from './server';
import { executeTool } from '$lib/workflows/site-tools/registry';
import { publishToolStep, requestToolConfirmation } from '$lib/jkai/tool-step-bus';
import { isDestructive, describeDestructiveAction } from '$lib/workflows/chat/confirmation-gate';
import { resolveDisplayTool, summarizeRunningTool, summarizeToolResult } from '$lib/workflows/chat/tool-summary';
import { dispatchMetaTool, JKAI_EXTENDED_TOOL } from './meta-tool';

// Phase 1.5: all 132 registered tools are exposed via MCP. Hermes' skill
// system constrains which subset the agent considers for a given chat
// (jkai-canvas for workflow chats; jkai-general + domain skills for /jkai).
// We trust the skill router; we don't gate at the MCP layer.

// SvelteKit loads .env into $env/dynamic/private at runtime. We lazy-import
// it so unit tests (which use plain process.env via beforeAll) don't need to
// stub the $env module. In SvelteKit runtime, env.HERMES_BRIDGE_SECRET wins;
// in vitest, process.env.HERMES_BRIDGE_SECRET is the fallback.
async function resolveSecret(): Promise<string> {
  if (process.env.HERMES_BRIDGE_SECRET) return process.env.HERMES_BRIDGE_SECRET;
  try {
    const mod = await import('$env/dynamic/private');
    return mod.env.HERMES_BRIDGE_SECRET ?? '';
  } catch {
    return '';
  }
}

// Echo back whatever protocol version the client requests, as long as it
// looks like an MCP date-stamped version. Per spec, the server MUST respond
// with the same version if it supports it, else its latest. We support the
// full stable protocol surface, so echoing is the safe default for forward
// and backward compat (e.g. Hermes' bundled SDK sends 2025-11-25 today, but
// older clients may send 2025-03-26).
const FALLBACK_PROTOCOL_VERSION = '2025-03-26';
const MCP_PROTOCOL_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponseOk {
  jsonrpc: '2.0';
  id: number | string | null;
  result: unknown;
}

export interface JsonRpcResponseErr {
  jsonrpc: '2.0';
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcResponseOk | JsonRpcResponseErr;

export interface DispatchContext {
  /**
   * Authorization-bearer value (the part after `Bearer `), or empty if absent.
   * Required for tools/list and tools/call; verified by constant-time compare
   * against `HERMES_BRIDGE_SECRET`. Only the transport handshake and liveness
   * probe (initialize, ping, notifications/*) are unauthenticated.
   */
  authBearer: string;
}

export interface DispatchResult {
  /**
   * The JSON-RPC response envelope, or null if this was a pure notification
   * (no id field). Callers should map null to HTTP 202 Accepted with empty
   * body, and a populated envelope to HTTP 200 + application/json.
   */
  response: JsonRpcResponse | null;
}

// JSON-RPC standard error codes — see https://www.jsonrpc.org/specification
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function isRequest(msg: unknown): msg is JsonRpcRequest {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.jsonrpc === '2.0' && typeof m.method === 'string';
}

function isNotification(msg: JsonRpcRequest): boolean {
  return msg.id === undefined;
}

function errResponse(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponseErr {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

function negotiateProtocolVersion(requested: unknown): string {
  if (typeof requested === 'string' && MCP_PROTOCOL_VERSION_PATTERN.test(requested)) {
    return requested;
  }
  return FALLBACK_PROTOCOL_VERSION;
}

async function verifyBearer(bearer: string): Promise<boolean> {
  const secret = await resolveSecret();
  if (!secret || !bearer) return false;
  const a = Buffer.from(bearer, 'utf8');
  const b = Buffer.from(secret, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Dispatch a parsed JSON-RPC envelope. Returns either a response envelope or
 * null (notification — no response). The route layer is responsible for the
 * HTTP wrapper (status + Content-Type).
 *
 * Auth model:
 *   - initialize, ping, notifications/*                → unauthenticated
 *                                                        (handshake + liveness only)
 *   - tools/list, tools/call                           → Authorization: Bearer
 *                                                        with constant-time match
 *                                                        against HERMES_BRIDGE_SECRET.
 *                                                        Scope binding happens at
 *                                                        the tool layer via the
 *                                                        workflow_id argument.
 */
export async function dispatchJsonRpc(
  msg: unknown,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  if (!isRequest(msg)) {
    return {
      response: errResponse(null, INVALID_REQUEST, 'Invalid JSON-RPC request'),
    };
  }

  const id = msg.id ?? null;
  const isNotif = isNotification(msg);

  try {
    switch (msg.method) {
      case 'initialize': {
        const requested = (msg.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
        const result = {
          protocolVersion: negotiateProtocolVersion(requested),
          // Tools-only server; no prompts/resources/logging. listChanged=false
          // because our tool registry is static at process start.
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: 'strange-rambling-svelte',
            version: '0.0.1',
          },
        };
        return { response: { jsonrpc: '2.0', id, result } };
      }

      case 'notifications/initialized':
      case 'notifications/cancelled':
      case 'notifications/progress':
      case 'notifications/roots/list_changed': {
        // Pure notifications — no response. The HTTP layer maps this to 202.
        return { response: null };
      }

      case 'ping': {
        // Per spec, ping returns an empty result object.
        return { response: { jsonrpc: '2.0', id, result: {} } };
      }

      case 'tools/list': {
        // Authenticated (changed 2026-07-25). This used to be open, which made
        // the whole tool catalogue — names, descriptions and input schemas —
        // readable by anyone who could POST to the endpoint, and `/api/mcp*`
        // deliberately bypasses the Auth.js gate as service-to-service traffic.
        // That is a map of every capability the assistant has, including which
        // integrations exist and what arguments they take.
        //
        // `initialize` and `ping` stay open on purpose: they are the transport
        // handshake and liveness probe and disclose nothing. Gating only the
        // catalogue keeps MCP clients able to connect while making them prove
        // who they are before they can enumerate. Hermes is unaffected — it
        // sends a static Authorization header on every request to this server
        // (mcp_servers.jkai.headers in ~/.hermes-jkai/config.yaml), and the
        // routing proxy at /api/mcp forwards that header verbatim.
        if (!(await verifyBearer(ctx.authBearer))) {
          return {
            response: errResponse(id, -32001, 'unauthorized: invalid or missing bearer token'),
          };
        }
        const tools = await listMcpTools();
        return { response: { jsonrpc: '2.0', id, result: { tools } } };
      }

      case 'tools/call': {
        const params = msg.params as
          | { name?: unknown; arguments?: unknown; _meta?: unknown }
          | undefined;
        const name = typeof params?.name === 'string' ? params.name : '';
        const args =
          params?.arguments && typeof params.arguments === 'object'
            ? (params.arguments as Record<string, unknown>)
            : {};
        const meta =
          params?._meta && typeof params._meta === 'object'
            ? (params._meta as Record<string, unknown>)
            : {};

        if (!name) {
          return {
            response: errResponse(id, INVALID_PARAMS, 'tools/call: params.name required'),
          };
        }

        if (!(await verifyBearer(ctx.authBearer))) {
          // Auth-shaped JSON-RPC error: -32001 lets clients (incl. Hermes')
          // distinguish auth failure from "tool itself errored".
          return {
            response: errResponse(id, -32001, 'unauthorized: invalid or missing bearer token'),
          };
        }

        // Surface this tool call to SSE subscribers (the canvas tool-step
        // panel + the general /jkai chat's attachment promoter). Canvas
        // chats pass `workflow_id` in the tool args; general /jkai chats
        // have no canvas, so Hermes' jkai_platform plugin injects the
        // chat_id into `params._meta.chat_id` (Phase 2 of the multi-origin
        // routing work). The chat-handler's `subscribeToolSteps(chatId,…)`
        // matches the latter; canvas subscribers continue to match the
        // former.
        const busKey = String(
          args.workflow_id ?? args.workflowId ?? meta.chat_id ?? '',
        );
        const stepId = `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        // The UI card should show the *real* tool, not the `jkai_extended`
        // meta-dispatcher or an `mcp_<server>_` prefix. Resolve it once for
        // every publish below (execution still uses the original name/args).
        const disp = resolveDisplayTool(name, args);

        // Destructive-action gate. Until 2026-07-27 this ran ONLY inside
        // general-chat.ts, which `JKAI_HERMES_CANVAS_CHAT=1` bypasses — so on
        // the live path nothing stood between the agent and `publish_page` /
        // `gmail_send` / `node_builder_commit_and_deploy` except Hermes' own
        // approval behaviour, detected site-side by string-matching its output.
        // Gate here, at the dispatcher, because this is the agent-driven
        // surface: `executeTool`'s other callers (heartbeat, briefing,
        // scheduled, selfimprove, workflow nodes) are headless by design and
        // must keep running unattended.
        //
        // `disp.tool` is deliberate — the real tool, resolved out of the
        // `jkai_extended` meta-dispatcher. Gating the outer name would wave
        // every destructive call straight through.
        if (isDestructive(disp.tool)) {
          const decision = await requestToolConfirmation(busKey, {
            tool: disp.tool,
            prompt: describeDestructiveAction(disp.tool, disp.args),
            args: disp.args,
          });
          if (!decision.approved) {
            const reason = decision.reason ?? 'the user declined';
            console.warn(
              `[mcp] blocked destructive tool ${disp.tool} (busKey=${busKey || 'none'}): ${reason}`,
            );
            // Record the block in the tool panel so there is a visible audit
            // trail rather than a silently missing step.
            if (busKey) {
              publishToolStep({
                workflowId: busKey,
                stepId,
                phase: 'failed',
                tool: disp.tool,
                args: disp.args,
                error: `blocked: ${reason}`,
                summary: `Blocked — ${reason}`,
                ts: Date.now(),
              });
            }
            // A normal result, NOT a JSON-RPC error: an error envelope reads as
            // a transport fault and invites a retry loop, whereas this reads as
            // "the human said no" and the agent replies to them instead.
            return {
              response: {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text:
                        `Not executed — ${disp.tool} needs confirmation and ${reason}. ` +
                        `Do not retry automatically; tell the user what you wanted to do and ask them directly.`,
                    },
                  ],
                },
              },
            };
          }
        }

        const startSummary = busKey ? summarizeRunningTool(disp.tool, disp.args) : '';
        if (busKey) {
          publishToolStep({
            workflowId: busKey,
            stepId,
            phase: 'started',
            tool: disp.tool,
            args: disp.args,
            summary: startSummary || undefined,
            ts: Date.now(),
          });
        }

        try {
          // Build the shared exec context once — used both by the normal
          // executeTool path and by the jkai_extended dispatcher (which
          // forwards it to executeTool internally on operation="invoke").
          const execCtx = {
            // Thread the chat_id through as conversationId so tool handlers
            // can wire chat-handoff features (e.g. workflow_build_from_spec
            // attaches a chat node configured with the originating
            // conversation id so the canvas chat continues the design talk).
            conversationId: typeof meta.chat_id === 'string' ? meta.chat_id : undefined,
            emit: (msg: string) => {
              // Heavyweight tools (workflow_create, generateWorkflow's internal
              // loop) can run for minutes. The Streamable HTTP transport buffers
              // the JSON-RPC response, so without this bridge every emit() call
              // would be invisible to the user. Forwarding emits as `progress`
              // events onto the in-process bus lets the chat-route subscriber
              // turn them into live `status` SSE frames.
              if (!busKey) return;
              const text = typeof msg === 'string' ? msg.trim() : '';
              if (!text) return;
              publishToolStep({
                workflowId: busKey,
                stepId,
                phase: 'progress',
                tool: disp.tool,
                summary: text,
                ts: Date.now(),
              });
            },
          };

          // jkai_extended isn't in the site-tools registry — it's an
          // MCP-layer dispatcher. Route it directly to dispatchMetaTool so
          // executeTool() doesn't return "Unknown tool".
          const out =
            name === JKAI_EXTENDED_TOOL.name
              ? await dispatchMetaTool(
                  args as Parameters<typeof dispatchMetaTool>[0],
                  execCtx,
                )
              : await executeTool(name, args, execCtx);
          if (busKey) {
            const raw = typeof out === 'string' ? out : JSON.stringify(out);
            const preview = raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
            const status: 'done' | 'error' =
              out && typeof out === 'object' && 'error' in (out as Record<string, unknown>) ? 'error' : 'done';
            const completionSummary = summarizeToolResult({
              tool: disp.tool,
              toolCallId: stepId,
              args: disp.args,
              result: out,
              status,
            });
            // Pull the human-readable error message out of the result so the
            // chat subscriber doesn't fall through to "unknown error". The
            // failed-phase publish path expects `error:` to be populated;
            // results shaped { success:false, error:"..." } would otherwise
            // strand the message inside `result` where the subscriber
            // ignores it.
            const failedMessage =
              status === 'error' && out && typeof out === 'object'
                ? (() => {
                    const o = out as Record<string, unknown>;
                    if (typeof o.error === 'string') return o.error;
                    if (o.error && typeof o.error === 'object') {
                      const err = o.error as Record<string, unknown>;
                      if (typeof err.message === 'string') return err.message;
                    }
                    return undefined;
                  })()
                : undefined;
            publishToolStep({
              workflowId: busKey,
              stepId,
              phase: status === 'error' ? 'failed' : 'completed',
              tool: disp.tool,
              resultPreview: preview,
              result: out,
              error: failedMessage,
              summary: completionSummary || undefined,
              ts: Date.now(),
            });
          }
          return {
            response: {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: typeof out === 'string' ? out : JSON.stringify(out),
                  },
                ],
              },
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'unknown error';
          if (busKey) {
            publishToolStep({
              workflowId: busKey,
              stepId,
              phase: 'failed',
              tool: disp.tool,
              error: message,
              ts: Date.now(),
            });
          }
          return {
            response: errResponse(id, INTERNAL_ERROR, message),
          };
        }
      }

      default: {
        if (isNotif) {
          // Unknown notification — silently accept. Clients sending unknown
          // notifications (e.g. future spec additions) shouldn't be told off.
          return { response: null };
        }
        return {
          response: errResponse(id, METHOD_NOT_FOUND, `Method not found: ${msg.method}`),
        };
      }
    }
  } catch (err) {
    if (isNotif) return { response: null };
    const message = err instanceof Error ? err.message : 'unknown error';
    return { response: errResponse(id, INTERNAL_ERROR, message) };
  }
}

/**
 * Parse a JSON string into a JSON-RPC message. Returns either a parsed value
 * or a parse-error response envelope ready to ship back to the client.
 */
export function parseJsonRpcBody(raw: string): { ok: true; value: unknown } | { ok: false; error: JsonRpcResponseErr } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return {
      ok: false,
      error: errResponse(null, PARSE_ERROR, 'Parse error'),
    };
  }
}
