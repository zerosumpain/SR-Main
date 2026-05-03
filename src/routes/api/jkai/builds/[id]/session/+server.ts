/**
 * Phase 5/6/7 — session POST endpoint. Replaces the WebSocket inbound
 * channel because Cloudflare's HTTP/2 layer doesn't proxy `Upgrade:
 * websocket` reliably. Outbound state still flows through the existing
 * SSE stream (`/api/jkai/builds/<id>/stream`) — the builder emits
 * session_pending / session_notes / session_shell_* via emitLive so any
 * panel listening to that stream picks the change up.
 *
 * Wire format: POST { kind, content?, id?, command? }
 *   kind:'inject'         {content}    queue user message
 *   kind:'inject_remove'  {id}         cancel queued message
 *   kind:'interrupt'                   SIGTERM the active pi child
 *   kind:'shell'          {command}    run in workdir, output via SSE
 *   kind:'note_add'       {content}    pin a directive
 *   kind:'note_remove'    {id}         remove pinned note
 *   kind:'snapshot'                    return current queue + notes
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { builderClient } from '$lib/jkai/builder-client';

export const POST: RequestHandler = async ({ params, request }) => {
  const buildId = params.id!;
  const body = (await request.json().catch(() => null)) as { kind?: string; [k: string]: unknown } | null;
  if (!body?.kind) throw error(400, 'kind required');
  try {
    switch (body.kind) {
      case 'inject':
        await builderClient.sessionInject(buildId, String(body.content ?? ''));
        return json({ ok: true });
      case 'inject_remove':
        await builderClient.sessionInjectRemove(buildId, Number(body.id));
        return json({ ok: true });
      case 'interrupt':
        return json(await builderClient.sessionInterrupt(buildId));
      case 'shell': {
        // Don't await — shell streams output asynchronously over SSE. Return
        // immediately so the panel doesn't block on long-running commands.
        void builderClient.sessionShell(buildId, String(body.command ?? '')).catch(() => {});
        return json({ ok: true });
      }
      case 'note_add':
        await builderClient.sessionAddNote(buildId, String(body.content ?? ''));
        return json({ ok: true });
      case 'note_remove':
        await builderClient.sessionRemoveNote(buildId, Number(body.id));
        return json({ ok: true });
      case 'snapshot':
        return json(await builderClient.sessionSnapshot(buildId));
      default:
        throw error(400, `unknown kind: ${body.kind}`);
    }
  } catch (e: unknown) {
    if (typeof e === 'object' && e && 'status' in e) throw e;
    throw error(400, e instanceof Error ? e.message : String(e));
  }
};
