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
import type { SseFrame, SseFrameToolCall } from '$lib/jkai/hermes-client';
import type { JobEvent } from '$lib/workflows/chat/job-store';

const RESULT_PREVIEW_MAX = 400;

/** Best-effort one-line preview of a tool result for the UI/summary. */
function previewResult(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result.slice(0, RESULT_PREVIEW_MAX);
  try {
    return JSON.stringify(result).slice(0, RESULT_PREVIEW_MAX);
  } catch {
    return String(result).slice(0, RESULT_PREVIEW_MAX);
  }
}

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
 * Defensive by contract: any frame that isn't a recognizable tool frame
 * (wrong kind, missing payload, unknown phase, or a missing tool name on the
 * start phase) yields `[]` so a malformed frame never crashes the stream.
 */
export function adaptToolFrameToJobEvents(frame: SseFrame): JobEvent[] {
  if (frame.kind !== 'tool') return [];
  const tc = readToolCall(frame);
  if (!tc || typeof tc !== 'object') return [];

  const toolName = (typeof tc.tool === 'string' && tc.tool) || (typeof tc.name === 'string' && tc.name) || '';
  const toolCallId =
    (typeof tc.tool_call_id === 'string' && tc.tool_call_id) ||
    (typeof tc.id === 'string' && tc.id) ||
    undefined;
  const summary = typeof tc.summary === 'string' ? tc.summary : undefined;

  switch (tc.phase) {
    case 'started': {
      // A start frame with no tool name is unusable — skip rather than emit a
      // nameless tool bubble.
      if (!toolName) return [];
      const args =
        tc.args && typeof tc.args === 'object'
          ? (tc.args as Record<string, unknown>)
          : tc.arguments && typeof tc.arguments === 'object'
            ? (tc.arguments as Record<string, unknown>)
            : {};
      return [{ type: 'tool_start', tool: toolName, args, toolCallId, summary }];
    }
    case 'progress':
      // Mid-call free-text progress → status bubble (parity with the bus's
      // `progress` → `status` mapping). No summary, nothing to surface.
      return summary ? [{ type: 'status', text: summary }] : [];
    case 'completed':
      return [{
        type: 'tool_result',
        tool: toolName,
        result: tc.result ?? null,
        status: 'done',
        toolCallId,
        summary: summary ?? (previewResult(tc.result) || undefined),
      }];
    case 'failed':
      return [{
        type: 'tool_result',
        tool: toolName,
        result: { error: tc.error ?? 'unknown error' },
        status: 'error',
        toolCallId,
        summary: summary ?? tc.error,
      }];
    default:
      // Unknown phase — ignore rather than throw.
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
