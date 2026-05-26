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
import type { SseFrame } from '$lib/jkai/hermes-client';
import type { JobEvent } from '$lib/workflows/chat/job-store';

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
