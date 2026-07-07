/**
 * Translates Hermes platform-adapter outbound frames into the legacy
 * `JobEvent` shape the canvas UI consumes via SSE. Lives in `$lib` (not
 * inline in `+server.ts`) so unit tests can exercise the mapping without
 * spinning up a SvelteKit request context.
 *
 * Frame semantics:
 *   - send:     a brand-new bubble. Treat content as a token delta.
 *   - replace:  an edit to an existing bubble — overwrite the in-flight
 *               content with the full new body.
 *   - thinking: a reasoning-delta for the collapsible Reasoning panel
 *               (rendered beside the assistant bubble, not inside it).
 *   - finalize: terminal frame. Returns [] — the caller emits its own
 *               `done` event with the accumulated content.
 *   - image/audio/video/pdf/document: media frames. The attachment row
 *               is folded into `result.attachments` on `done` by the
 *               caller; per-frame JobEvent is not emitted.
 */
import type { SseFrame, SseFrameToolCall, SseFrameSubagent } from '$lib/jkai/hermes-client';
import type { JobEvent, DelegateChild } from '$lib/workflows/chat/job-store';
import { resolveDisplayTool, summarizeRunningTool, summarizeToolResult } from '$lib/workflows/chat/tool-summary';

/**
 * Extract the tool-call payload from a frame, tolerating the three shapes the
 * Hermes plugin could plausibly use (see `SseFrameToolCall` for the
 * assumption + rationale): a top-level `frame.tool`, or a nested
 * `frame.metadata.tool` / `frame.metadata.tool_call`. Returns null when the
 * frame carries no recognizable tool payload — callers then skip it safely.
 */
function readToolCall(frame: SseFrame): SseFrameToolCall | null {
  const candidates: unknown[] = [
    frame.tool,
    (frame.metadata as Record<string, unknown> | undefined)?.['tool'],
    (frame.metadata as Record<string, unknown> | undefined)?.['tool_call'],
  ];
  for (const c of candidates) {
    if (c && typeof c === 'object') return c as SseFrameToolCall;
  }
  return null;
}

/**
 * Translate a Hermes `tool` SSE frame into the SAME tool-step JobEvents the
 * in-repo orchestrator emits (see `/api/workflows/orchestrator/chat`'s
 * `tool-step-bus` subscriber): `started` → `tool_start`; `progress` →
 * `status`; `completed`/`failed` → `tool_result`. Field names match the
 * legacy emitter exactly (`tool`, `args`, `toolCallId`, `summary`, `result`,
 * `status`).
 *
 * De-dupe against the in-process tool-step bus. Hermes core fires `send_tool`
 * for EVERY agent tool call (gateway/run.py wires `tool_start_callback` /
 * `tool_complete_callback` with no MCP gating), so a tool that routes back
 * through THIS SvelteKit MCP server surfaces on BOTH the bus AND this `tool`
 * frame — under two different id-spaces (bus `stepId` vs Hermes
 * `tool_call_id`), which ChatArea's `tool_start` handler would render as two
 * separate steps. The bus is the richer source (full untruncated result →
 * inline artifacts + attachment promotion, plus mid-call `progress`), whereas
 * `send_tool` preview-caps results to 600 chars. So the caller passes
 * `isBusServedTool` identifying tools the bus already covers; we drop the
 * frame for those and keep it only for Hermes built-ins / skills / other MCP
 * servers that never touch the bus.
 *
 * Defensive by contract: any frame that isn't a recognizable tool frame
 * (wrong kind, missing payload, unknown phase, or a missing tool name on the
 * start phase) yields `[]` so a malformed frame never crashes the stream.
 */
export function adaptToolFrameToJobEvents(
  frame: SseFrame,
  isBusServedTool?: (toolName: string) => boolean,
): JobEvent[] {
  if (frame.kind !== 'tool') return [];
  const tc = readToolCall(frame);
  if (!tc || typeof tc !== 'object') return [];

  const toolName = (typeof tc.tool === 'string' && tc.tool) || (typeof tc.name === 'string' && tc.name) || '';

  // The in-process bus is authoritative for tools it serves — skip the
  // duplicate Hermes frame to avoid a double-rendered tool step.
  if (toolName && isBusServedTool?.(toolName)) return [];
  const toolCallId =
    (typeof tc.tool_call_id === 'string' && tc.tool_call_id) ||
    (typeof tc.id === 'string' && tc.id) ||
    undefined;
  const summary = typeof tc.summary === 'string' ? tc.summary : undefined;
  const rawArgs =
    tc.args && typeof tc.args === 'object'
      ? (tc.args as Record<string, unknown>)
      : tc.arguments && typeof tc.arguments === 'object'
        ? (tc.arguments as Record<string, unknown>)
        : {};
  // Surviving frames here are Hermes built-ins / skills / other MCP servers the
  // bus never covers (bus-served tools were dropped above). Show the real tool
  // (strip any `mcp_<server>_` prefix) and a *worded* outcome — not a raw JSON
  // blob — when Hermes didn't supply its own `summary`.
  const disp = resolveDisplayTool(toolName, rawArgs);

  switch (tc.phase) {
    case 'started': {
      // A start frame with no tool name is unusable — skip rather than emit a
      // nameless tool bubble.
      if (!toolName) return [];
      return [{
        type: 'tool_start',
        tool: disp.tool,
        args: disp.args,
        toolCallId,
        summary: summary ?? (summarizeRunningTool(disp.tool, disp.args) || undefined),
      }];
    }
    case 'progress':
      // Mid-call free-text progress → status bubble (parity with the bus's
      // `progress` → `status` mapping). No summary, nothing to surface.
      return summary ? [{ type: 'status', text: summary }] : [];
    case 'completed': {
      // `delegate_task` completed frames carry parsed per-child rows (the
      // sub-agent visualizer); undefined for every other tool, so they ride
      // through unchanged.
      const children = Array.isArray(tc.children) ? (tc.children as DelegateChild[]) : undefined;
      return [{
        type: 'tool_result',
        tool: disp.tool,
        result: tc.result ?? null,
        status: 'done',
        toolCallId,
        summary: summary ?? (summarizeToolResult({ tool: disp.tool, toolCallId: toolCallId ?? '', args: disp.args, result: tc.result ?? null, status: 'done', ...(children && children.length ? { children } : {}) }) || undefined),
        ...(children && children.length ? { children } : {}),
      }];
    }
    case 'failed':
      return [{
        type: 'tool_result',
        tool: disp.tool,
        result: { error: tc.error ?? 'unknown error' },
        status: 'error',
        toolCallId,
        summary: summary ?? summarizeToolResult({ tool: disp.tool, toolCallId: toolCallId ?? '', args: disp.args, result: { error: tc.error ?? 'unknown error' }, status: 'error' }),
      }];
    default:
      // Unknown phase — ignore rather than throw.
      return [];
  }
}

/**
 * Translate a Hermes `subagent` frame (live `delegate_task` child activity,
 * relayed via the gateway's child tool_progress bridge → the plugin's
 * `send_subagent`) into the `subagent_start` / `subagent_event` / `subagent_done`
 * JobEvents the chat UI's sub-agent visualizer (ChatArea `subAgents` state +
 * `SubAgentBubble`) already consumes. Hermes swallows per-child tool
 * *completions* and only surfaces tool *starts* + a final `subagent.complete`,
 * so each child tool renders as a start; ChatArea marks the prior step done when
 * the next one arrives and closes any lingering step on `subagent_done`.
 *
 * Defensive by contract: a frame missing `metadata.subagent` or a sub-agent id
 * yields `[]` so a malformed frame never crashes the stream.
 */
export function adaptSubagentFrameToJobEvents(frame: SseFrame): JobEvent[] {
  if (frame.kind !== 'subagent') return [];
  const raw = (frame.metadata as Record<string, unknown> | undefined)?.['subagent'];
  if (!raw || typeof raw !== 'object') return [];
  const sub = raw as SseFrameSubagent;
  const id = sub.identity?.subagent_id
    ?? (sub.identity?.task_index != null ? `sub-${sub.identity.task_index}` : undefined);
  if (!id) return [];

  const preview = typeof sub.preview === 'string' ? sub.preview : undefined;
  switch (sub.event_type) {
    case 'subagent.start':
      return [{
        type: 'subagent_start',
        agentId: id,
        parentStepId: null,
        task: (sub.identity?.goal && String(sub.identity.goal)) || preview || 'sub-agent',
      }];
    case 'subagent.tool': {
      const toolName = typeof sub.tool === 'string' ? sub.tool : '';
      if (!toolName) return [];
      const rawArgs = sub.args && typeof sub.args === 'object' ? sub.args : {};
      const disp = resolveDisplayTool(toolName, rawArgs);
      return [{
        type: 'subagent_event',
        agentId: id,
        event: {
          type: 'tool_start',
          tool: disp.tool,
          args: disp.args,
          summary: summarizeRunningTool(disp.tool, disp.args) || preview,
        },
      }];
    }
    case 'subagent.complete':
      return [{
        type: 'subagent_done',
        agentId: id,
        summary: preview || (sub.identity?.status === 'error' ? 'failed' : 'done'),
        result: {},
      }];
    // subagent.thinking / subagent.progress are batched free-text with no
    // structural home in the visualizer — skip rather than emit noise.
    default:
      return [];
  }
}

export function adaptFrameToCanvasSse(frame: SseFrame): JobEvent[] {
  switch (frame.kind) {
    case 'send':
      return [{ type: 'token', delta: frame.content }];
    case 'replace':
      return [{ type: 'replace_bubble', content: frame.content }];
    case 'thinking':
      return [{
        type: 'thinking' as const,
        delta: frame.content,
        messageId: frame.message_id,
      }];
    case 'tool':
      // Tool-call frames are handled by `adaptToolFrameToJobEvents` in the
      // chat route (which also folds inline attachments from results into the
      // turn). Returning [] here keeps text/media streaming behavior unchanged
      // while making the tool path explicit rather than silently dropping it
      // through the default branch.
      return [];
    case 'approval': {
      // Dangerous-command gate. The payload rides in `metadata.approval`
      // (mirrors the tool-frame convention). Read every field defensively so a
      // malformed frame is skipped rather than crashing the stream; a missing
      // command is unusable, so skip it — the gateway's text fallback + the
      // slash-affordance matcher still cover that case.
      const raw = (frame.metadata as Record<string, unknown> | undefined)?.['approval'];
      if (!raw || typeof raw !== 'object') return [];
      const o = raw as Record<string, unknown>;
      const command = typeof o.command === 'string' ? o.command : '';
      if (!command) return [];
      return [{
        type: 'approval',
        command,
        description: typeof o.description === 'string' ? o.description : '',
        sessionKey: typeof o.session_key === 'string' ? o.session_key : '',
      }];
    }
    case 'finalize':
      // The jkai adapter emits a synthetic `finalize` with empty content
      // once `handle_message` finishes — the actual reply text has already
      // been delivered via prior `send` frames. The pump uses
      // `job.partialResponse` (accumulated from those `send` frames) for
      // the final `message` field, so we don't return a `done` event here.
      return [];
    case 'image':
    case 'audio':
    case 'video':
    case 'pdf':
    case 'document':
      // Media frames carry an attachment id that was uploaded by the
      // jkai_platform plugin to `/api/jkai/attachments`. The chat UI's
      // attachment-render path keys off `result.attachments` on the
      // terminating `done` event — so we don't emit a per-frame JobEvent
      // here; the pump collects the attachment metadata and folds it
      // into `job.result.attachments` before dispatching `done`.
      return [];
    default:
      return [];
  }
}
