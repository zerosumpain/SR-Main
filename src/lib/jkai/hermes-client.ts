import { mintBridgeToken, type TokenKind, type TokenScope } from '$lib/mcp/auth';

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
  /** Where this chat originated. Hermes uses it to route MCP tool calls
   * back to the correct SvelteKit host (VPS or homeserv). Defaults to
   * the host running this client (see `defaultOrigin` / `defaultMcpUrl`
   * on the HermesClient config). */
  origin?: 'vps' | 'homeserv';
  mcpUrl?: string;
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
 * ASSUMPTION (#15): the Hermes jkai_platform plugin does not yet emit a
 * dedicated `tool` OutboundFrame — today its tool calls only surface via the
 * in-process MCP `tool-step-bus` (tools that route back through this
 * SvelteKit MCP server). This shape is the forward-looking contract for when
 * the plugin starts streaming tool telemetry for ITS OWN / non-MCP tools
 * (Hermes built-ins, skills, other MCP servers) that never touch our bus.
 * It mirrors Hermes' internal `tool_calls` vocabulary (`name` + `arguments`)
 * and the existing `OutboundFrame` convention of stashing structured data in
 * `metadata`. The mapper in `sse-adapter.ts` guards every field so an unknown
 * shape is skipped rather than throwing. */
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
  kind: 'send' | 'replace' | 'finalize' | 'thinking' | 'image' | 'audio' | 'video' | 'pdf' | 'document' | 'tool';
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
        origin: req.origin ?? this.config.defaultOrigin ?? 'homeserv',
        mcp_url: req.mcpUrl ?? this.config.defaultMcpUrl ?? 'http://127.0.0.1:5173/api/mcp/local',
      }),
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(`hermes inbound returned ${resp.status}: ${body.error ?? 'unknown'}`);
    }

    const body = await resp.json();
    return { accepted: Boolean(body.accepted), chatId: body.chat_id };
  }

  async *openStream(ctx: SessionContext): AsyncGenerator<SseFrame, void, undefined> {
    const token = this.mintToken(ctx);
    const url = new URL(`${this.config.baseUrl}/platforms/jkai/out`);
    url.searchParams.set('chat_id', ctx.chatId);

    const resp = await fetch(url, { headers: { 'Bridge-Token': token } });
    if (!resp.ok) throw new Error(`hermes stream returned ${resp.status}`);
    if (!resp.body) throw new Error('hermes stream has no body');

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
  }
}
