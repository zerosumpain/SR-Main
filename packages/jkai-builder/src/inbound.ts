/**
 * WebSocket inbound dispatcher — turns user-typed events into orchestrator
 * effects: queue a message, abort the current pi, run a shell command in
 * the build's workdir, add/remove a pinned note. Each handler emits a
 * snapshot of the relevant state back over the WS so the user gets
 * immediate feedback (queued message visible, note added, etc.).
 */
import { spawn } from 'node:child_process';
import { interruptActiveChild } from '$lib/jkai/interrupt-registry';
import {
  enqueuePendingMessage,
  listPendingMessages,
  removePendingMessage,
} from '$lib/jkai/pending-messages';
import { addNote, listNotes, removeNote } from '$lib/jkai/build-notes';
import { emitLog } from '$lib/jkai/log-emitter';

type Send = (payload: unknown) => void;

export async function handleInbound(
  buildId: string,
  msg: { kind?: string; [k: string]: unknown },
  send: Send,
): Promise<void> {
  switch (msg.kind) {
    case 'inject': {
      const content = String(msg.content ?? '').trim();
      if (!content) { send({ kind: 'error', message: 'empty inject' }); return; }
      await enqueuePendingMessage(buildId, content);
      const queue = await listPendingMessages(buildId);
      send({ kind: 'pending', queue });
      await emitLog(buildId, 'system', `User injected: ${content.slice(0, 200)}`);
      return;
    }
    case 'inject_remove': {
      const id = Number(msg.id);
      if (!Number.isFinite(id)) { send({ kind: 'error', message: 'invalid inject id' }); return; }
      await removePendingMessage(buildId, id);
      const queue = await listPendingMessages(buildId);
      send({ kind: 'pending', queue });
      return;
    }
    case 'interrupt': {
      const ok = interruptActiveChild(buildId);
      send({ kind: 'interrupted', ok });
      if (ok) await emitLog(buildId, 'system', 'User interrupted current iteration. The agent will see [user-interrupted] in its next turn.');
      return;
    }
    case 'shell': {
      const command = String(msg.command ?? '').trim();
      if (!command) { send({ kind: 'error', message: 'empty shell command' }); return; }
      await runShell(buildId, command, send);
      return;
    }
    case 'note_add': {
      const content = String(msg.content ?? '').trim();
      if (!content) { send({ kind: 'error', message: 'empty note' }); return; }
      await addNote(buildId, content);
      send({ kind: 'notes', notes: await listNotes(buildId) });
      await emitLog(buildId, 'system', `Pinned note: ${content.slice(0, 200)}`);
      return;
    }
    case 'note_remove': {
      const id = Number(msg.id);
      if (!Number.isFinite(id)) { send({ kind: 'error', message: 'invalid note id' }); return; }
      await removeNote(buildId, id);
      send({ kind: 'notes', notes: await listNotes(buildId) });
      return;
    }
    default:
      send({ kind: 'error', message: `unknown inbound kind: ${msg.kind}` });
  }
}

const BUILDS_ROOT = process.env.JKAI_BUILDS_ROOT ?? '/home/jkai/workspace';

/** Run a user-issued shell command in the build's `dev/` directory and stream
 *  output back over the WS. Append a transcript line to jkai_logs so the
 *  agent sees `[user-shell]` in the next iteration's evaluation context. */
async function runShell(buildId: string, command: string, send: Send): Promise<void> {
  const cwd = `${BUILDS_ROOT === '/opt/jkai-builds' ? '/home/jkai/workspace' : BUILDS_ROOT}/${buildId}/dev`;
  send({ kind: 'shell_start', command });
  const child = spawn('bash', ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdoutBuf = '';
  let stderrBuf = '';
  child.stdout?.setEncoding('utf-8');
  child.stderr?.setEncoding('utf-8');
  child.stdout?.on('data', (chunk: string) => {
    stdoutBuf += chunk;
    send({ kind: 'shell_chunk', stream: 'stdout', text: chunk });
  });
  child.stderr?.on('data', (chunk: string) => {
    stderrBuf += chunk;
    send({ kind: 'shell_chunk', stream: 'stderr', text: chunk });
  });
  const exitCode: number = await new Promise((r) => child.on('close', (c) => r(c ?? 0)));
  send({ kind: 'shell_end', exitCode });
  // Persist a transcript so the agent's next evaluation context includes
  // what the user did. Trimmed to keep the log usable.
  const transcript = `[user-shell] $ ${command}\n${stdoutBuf}${stderrBuf ? `\n[stderr] ${stderrBuf}` : ''}`.slice(0, 4000);
  await emitLog(buildId, 'output', transcript);
}
