import { mintBridgeToken, type TokenKind, type TokenScope } from '$lib/mcp/auth';
import type { HermesInboundAttachment } from '$lib/jkai/media/hermes-attachments';
import { Agent } from 'undici';

// Hermes' `/out` SSE stream stays open for the whole turn. For a `delegate_task`
// that can be 10-20 min while child agents grind through silent LLM loops that
// emit no frames — a gap far longer than undici's default 300s `bodyTimeout`,
// which would abort the read mid-delegation and strand the turn on a stale
// "⏳ Working…" partial (the real result never arrives). Give this one long-lived
// stream a dispatcher with the idle body-timeout disabled; ordinary fetches keep
// undici's safe defaults. `headersTimeout` stays bounded so a dead connection at
// connect still fails fast — only the between-frames body idle is unbounded.
const streamDispatcher = new Agent({ bodyTimeout: 0, headersTimeout: 60_000 });

export interface HermesClientConfig {
  baseUrl: string;
  bridgeSecret: string;
  defaultExpiryMs?: number;
  /** Default origin to stamp on outgoing messages when the caller doesn't
   * pass one. Tells the Hermes-side MCP routing proxy which SvelteKit
   * host owns this chat's data. */
  defaultOrigin?: 'vps' | 'homeserv';
  defaultMcpUrl?: string;
}

export interface SessionContext {
  chatId: string;
  kind: TokenKind;
  kindId: string;
  sessionId: string;
}

export interface SendMessageRequest extends SessionContext {
  text: string;
  /** Identifies this turn end-to-end. Hermes' jkai plugin stamps it onto
   * every frame the turn produces (`metadata.turn_id`) so the consumer can
   * tell its own output from a previous turn's leftovers — the outbound
   * queue is keyed by chat alone, and whichever connection is attached
   * drains it. Pass the job id. */
  turnId?: string;
  /** Where this chat originated. Hermes uses it to route MCP tool calls
   * back to the correct SvelteKit host (VPS or homeserv). Defaults to
   * the host running this client (see `defaultOrigin` / `defaultMcpUrl`
   * on the HermesClient config). */
  origin?: 'vps' | 'homeserv';
  mcpUrl?: string;
  /** Files the user attached to this turn, bytes and all. The plugin writes
   *  them into Hermes' media cache and hands the agent local paths via
   *  `MessageEvent.media_urls`, which is what routes an image to the model's
   *  vision input. Built by `buildHermesAttachments` — see that module for why
   *  the bytes ride inline rather than as a URL Hermes fetches. */
  attachments?: HermesInboundAttachment[];
}

export interface SendMessageResponse {
  accepted: boolean;
  chatId: string;
}

/** Outbound attachment metadata emitted by the jkai_platform plugin on
 * media frames (`image` / `audio` / `video` / `pdf` / `document`). Matches
 * the row shape returned by `POST /api/jkai/attachments`. */
export interface SseFrameAttachment {
  id: string;
  kind: 'image' | 'audio' | 'video' | 'pdf' | 'document' | 'text';
  mimeType: string;
  originalName: string | null;
  sizeBytes: number;
  source: 'web' | 'whatsapp' | 'generated';
}

/** Per-tool-call telemetry carried on a `tool` SSE frame. Surfaced as
 * `tool_start` / `tool_result` / `status` JobEvents so the canvas tool-step
 * panel renders Hermes tool invocations exactly like the in-repo
 * orchestrator's steps.
 *
 * The Hermes jkai_platform plugin's `send_tool` (adapter.py) emits these
 * `tool` OutboundFrames, driven by gateway/run.py's tool_start/complete
 * callbacks — which fire for EVERY agent tool call with no MCP gating. So a
 * tool that also routes back through this SvelteKit MCP server surfaces twice:
 * once on the in-process `tool-step-bus` (richer — full untruncated result +
 * mid-call progress) and once as this frame (result preview-capped to 600
 * chars). The mapper in `sse-adapter.ts` de-dupes by dropping the frame for
 * bus-served tools (`isBusServedTool`), so this frame is the SOLE source only
 * for Hermes built-ins / skills / other MCP servers that never touch the bus.
 * The shape mirrors Hermes' internal `tool_calls` vocabulary (`name` +
 * `arguments`) and the `OutboundFrame` convention of stashing structured data
 * in `metadata`; the mapper guards every field so an unknown shape is skipped
 * rather than throwing. */
export interface SseFrameToolCall {
  /** Lifecycle phase. `started` → tool_start; `completed`/`failed` →
   * tool_result; `progress` → a status bubble. */
  phase: 'started' | 'progress' | 'completed' | 'failed';
  /** Tool name, e.g. `workflow_add_node`. Hermes may also send it as
   * `name`; the mapper accepts either. */
  tool?: string;
  name?: string;
  /** Stable id correlating started ↔ completed for the same call. */
  tool_call_id?: string;
  id?: string;
  /** Call arguments (start phase). */
  args?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
  /** Tool output (completed phase). */
  result?: unknown;
  /** Error string (failed phase). */
  error?: string;
  /** Short human-readable summary for the UI (parity with the legacy
   * emitter's `summary` field). */
  summary?: string;
  /** Sub-agent rows on a `delegate_task` completed frame — the adapter parses
   * the delegation result into per-child rows before the result preview cap
   * (adapter.py `_extract_delegate_children`). Loose-typed here; sse-adapter
   * narrows it to `DelegateChild[]` for the tool-step UI. */
  children?: unknown[];
}

/** Payload for a `kind: 'subagent'` frame — live activity relayed from a
 *  `delegate_task` child agent. Emitted by the plugin's `send_subagent` (wired
 *  from the gateway's child tool_progress relay). Rides in `metadata.subagent`.
 *  `event_type` is one of `subagent.start` / `subagent.tool` / `subagent.thinking`
 *  / `subagent.progress` / `subagent.complete`; `identity` carries the sub-agent
 *  id + goal + task index so the UI can group per-worker. */
export interface SseFrameSubagent {
  event_type: string;
  tool?: string | null;
  preview?: string | null;
  args?: Record<string, unknown> | null;
  identity?: {
    subagent_id?: string;
    parent_id?: string;
    task_index?: number;
    task_count?: number;
    goal?: string;
    tool_count?: number;
    model?: string | null;
    status?: string;
    [k: string]: unknown;
  };
}

export interface SseFrame {
  /** `send`/`replace`/`finalize` are text-bubble frames; `thinking` carries
   *  a reasoning-delta for the collapsible Reasoning panel (rendered
   *  alongside the in-flight assistant bubble, not inside it); `image`/
   *  `audio`/`video`/`pdf`/`document` carry an attachment uploaded to
   *  `/api/jkai/attachments` so the chat UI can render the bytes inline
   *  instead of the legacy `🖼️ Image: …` / `🔊 Audio: …` / `🎬 Video: …` /
   *  `📎 File: …` text placeholders the Hermes BasePlatformAdapter falls
   *  back to; `tool` carries per-tool-call telemetry (see `SseFrameToolCall`)
   *  surfaced onto the tool-step panel. */
  kind: 'send' | 'replace' | 'finalize' | 'thinking' | 'image' | 'audio' | 'video' | 'pdf' | 'document' | 'tool' | 'approval' | 'clarify' | 'subagent';
  chat_id: string;
  message_id: string;
  content: string;
  metadata: Record<string, unknown>;
  ts: number;
  attachment?: SseFrameAttachment;
  /** Populated only on `kind: 'tool'` frames. The plugin may also nest the
   * same payload under `metadata.tool` / `metadata.tool_call`; the mapper
   * checks both locations. */
  tool?: SseFrameToolCall;
}

export interface HermesHealth {
  /** Identifies the runtime PROCESS, not the service — changes on every restart. */
  bootId: string | null;
  startedAt: number | null;
  /**
   * How the gateway stamps `metadata.turn_id` on outbound frames.
   *
   * `'execution'` — bound to the task actually producing the frame, so an
   * untagged frame provably belongs to no turn and a consumer may reject it.
   * `null` — an older gateway. It stamped on ARRIVAL, where a message landing
   * mid-turn relabelled the running turn's output, so tags separate nothing and
   * untagged frames must be accepted or every reply would be dropped.
   */
  turnTagging: string | null;
  /**
   * How the gateway treats a message that lands while a turn is running.
   *
   * `'queue'` runs them in order, one answer each. `'interrupt'` / `'redirect'` /
   * `'steer'` fold the new message into the RUNNING turn, so two messages produce
   * ONE run carrying the first turn's id.
   *
   * The consumer has to know, because the correct behaviour is OPPOSITE in the
   * two cases. Under interrupt it must adopt the turn it superseded, or it
   * rejects the output that is answering it. Under queue it must NOT adopt it, or
   * it renders the previous turn's answer as this one's — measured, with the
   * continuation of a "count to 200" landing under "reply with BRAVO".
   */
  busyInputMode: string | null;
}

export class HermesClient {
  constructor(private config: HermesClientConfig) {}

  private mintToken(ctx: SessionContext): string {
    const scope: TokenScope = {
      sessionId: ctx.sessionId,
      kind: ctx.kind,
      kindId: ctx.kindId,
      expiresAt: Date.now() + (this.config.defaultExpiryMs ?? 3_600_000),
    };
    return mintBridgeToken(scope, this.config.bridgeSecret);
  }

  async sendMessage(req: SendMessageRequest): Promise<SendMessageResponse> {
    const token = this.mintToken(req);
    const resp = await fetch(`${this.config.baseUrl}/platforms/jkai/msg`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bridge-Token': token,
      },
      body: JSON.stringify({
        chat_id: req.chatId,
        text: req.text,
        kind: req.kind,
        kind_id: req.kindId,
        session_id: req.sessionId,
        turn_id: req.turnId,
        origin: req.origin ?? this.config.defaultOrigin ?? 'homeserv',
        mcp_url: req.mcpUrl ?? this.config.defaultMcpUrl ?? 'http://127.0.0.1:5173/api/mcp/local',
        // Omitted entirely on a text-only turn so the body stays byte-identical
        // to what it was before attachments existed (an older plugin ignores
        // the field either way, but the common case shouldn't grow a null).
        ...(req.attachments && req.attachments.length > 0
          ? { attachments: req.attachments }
          : {}),
      }),
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(`hermes inbound returned ${resp.status}: ${body.error ?? 'unknown'}`);
    }

    const body = await resp.json();
    return { accepted: Boolean(body.accepted), chatId: body.chat_id };
  }

  /**
   * Liveness probe. `bootId` identifies the runtime PROCESS, not the service —
   * it changes on every restart, which is the only way to tell "Hermes is up"
   * from "Hermes is up again". See `ensureModelPinned`.
   *
   * Returns null rather than throwing: a failed probe must never block a turn.
   */
  async health(): Promise<HermesHealth | null> {
    try {
      const resp = await fetch(`${this.config.baseUrl}/platforms/jkai/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!resp.ok) return null;
      const body = (await resp.json()) as {
        boot_id?: string;
        started_at?: number;
        turn_tagging?: string;
        busy_input_mode?: string;
      };
      return {
        bootId: body.boot_id ?? null,
        startedAt: body.started_at ?? null,
        turnTagging: body.turn_tagging ?? null,
        busyInputMode: body.busy_input_mode ?? null,
      };
    } catch {
      return null;
    }
  }

  async *openStream(ctx: SessionContext, opts?: { signal?: AbortSignal }): AsyncGenerator<SseFrame, void, undefined> {
    const token = this.mintToken(ctx);
    const url = new URL(`${this.config.baseUrl}/platforms/jkai/out`);
    url.searchParams.set('chat_id', ctx.chatId);

    // `dispatcher` is an undici (Node fetch) extension not in the DOM RequestInit
    // type; `signal` propagates job cancellation so a killed/cancelled turn tears
    // the upstream connection down instead of leaking it.
    const resp = await fetch(url, {
      headers: { 'Bridge-Token': token },
      signal: opts?.signal,
      dispatcher: streamDispatcher,
    } as RequestInit & { dispatcher: Agent });
    if (!resp.ok) throw new Error(`hermes stream returned ${resp.status}`);
    if (!resp.body) throw new Error('hermes stream has no body');

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          try {
            const payload = JSON.parse(dataLine.slice(5).trim()) as SseFrame;
            yield payload;
          } catch {
            // skip malformed frame
          }
        }
      }
    } catch (err) {
      // A job abort/cancel surfaces here as an AbortError — that's an intentional
      // teardown, not a stream failure, so end the generator quietly and let the
      // caller finalize on its own `signal.aborted` check.
      if (opts?.signal?.aborted) return;
      throw err;
    } finally {
      // The consumer (chat route) breaks its `for await` on job abort; make sure
      // the upstream connection is torn down rather than left dangling.
      try { await reader.cancel(); } catch { /* already closed */ }
    }
  }
}
