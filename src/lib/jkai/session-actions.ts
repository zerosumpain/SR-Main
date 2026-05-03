/**
 * Session actions exposed to the builder's RPC dispatcher (Phases 5/6/7).
 * The SvelteKit web app's POST /api/jkai/builds/<id>/session route forwards
 * to these via builder-client. Each action mutates orchestrator-owned state
 * (pending queue / notes / running pi child / sandbox shell) and emits a
 * LiveEvent so the existing SSE stream can deliver the change to all
 * connected build pages without a separate WebSocket.
 *
 * Why SSE-not-WS: Cloudflare's HTTP/2 layer doesn't proxy `Upgrade:
 * websocket` reliably (downgrades the request, misses our upgrade handler,
 * falls through to the SvelteKit auth gate as a normal GET). SSE goes
 * through unchanged, and inbound is short-lived POST anyway.
 */
import { spawn } from 'node:child_process';
import { interruptActiveChild } from './interrupt-registry';
import {
  enqueuePendingMessage,
  listPendingMessages,
  removePendingMessage,
} from './pending-messages';
import { addNote, listNotes, removeNote } from './build-notes';
import { emitLog, emitLive } from './log-emitter';

const BUILDS_ROOT = process.env.JKAI_BUILDS_ROOT === '/opt/jkai-builds'
  ? '/home/jkai/workspace'
  : process.env.JKAI_BUILDS_ROOT ?? '/home/jkai/workspace';

export async function sessionInject(buildId: string, content: string): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('empty inject');
  await enqueuePendingMessage(buildId, trimmed);
  const queue = await listPendingMessages(buildId);
  emitLive(buildId, { type: 'session_pending', iterationId: null, streamId: 'session', payload: { queue } });
  await emitLog(buildId, 'system', `User injected: ${trimmed.slice(0, 200)}`);
}

export async function sessionInjectRemove(buildId: string, id: number): Promise<void> {
  await removePendingMessage(buildId, id);
  const queue = await listPendingMessages(buildId);
  emitLive(buildId, { type: 'session_pending', iterationId: null, streamId: 'session', payload: { queue } });
}

export async function sessionInterrupt(buildId: string): Promise<{ ok: boolean }> {
  const ok = interruptActiveChild(buildId);
  emitLive(buildId, { type: 'session_interrupted', iterationId: null, streamId: 'session', payload: { ok } });
  if (ok) await emitLog(buildId, 'system', 'User interrupted current iteration. The agent will see [user-interrupted] in its next turn.');
  return { ok };
}

export async function sessionAddNote(buildId: string, content: string): Promise<void> {
  await addNote(buildId, content);
  const notes = await listNotes(buildId);
  emitLive(buildId, { type: 'session_notes', iterationId: null, streamId: 'session', payload: { notes } });
  await emitLog(buildId, 'system', `Pinned note: ${content.trim().slice(0, 200)}`);
}

export async function sessionRemoveNote(buildId: string, id: number): Promise<void> {
  await removeNote(buildId, id);
  const notes = await listNotes(buildId);
  emitLive(buildId, { type: 'session_notes', iterationId: null, streamId: 'session', payload: { notes } });
}

/** Initial state snapshot for a panel that just connected to the SSE stream. */
export async function sessionSnapshot(buildId: string): Promise<{ queue: unknown[]; notes: unknown[] }> {
  const [queue, notes] = await Promise.all([
    listPendingMessages(buildId),
    listNotes(buildId),
  ]);
  return { queue, notes };
}

/** Run a user-issued shell command in the build's `dev/` workdir, stream
 *  output as session_shell_chunk live events, persist transcript so the
 *  agent's next iteration sees [user-shell] in its evaluation context. */
export async function sessionShell(buildId: string, command: string): Promise<void> {
  const trimmed = command.trim();
  if (!trimmed) throw new Error('empty shell command');
  const cwd = `${BUILDS_ROOT}/${buildId}/dev`;
  emitLive(buildId, { type: 'session_shell_start', iterationId: null, streamId: 'session', payload: { command: trimmed } });
  const child = spawn('bash', ['-c', trimmed], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdoutBuf = '';
  let stderrBuf = '';
  child.stdout?.setEncoding('utf-8');
  child.stderr?.setEncoding('utf-8');
  child.stdout?.on('data', (chunk: string) => {
    stdoutBuf += chunk;
    emitLive(buildId, { type: 'session_shell_chunk', iterationId: null, streamId: 'session', payload: { stream: 'stdout', text: chunk } });
  });
  child.stderr?.on('data', (chunk: string) => {
    stderrBuf += chunk;
    emitLive(buildId, { type: 'session_shell_chunk', iterationId: null, streamId: 'session', payload: { stream: 'stderr', text: chunk } });
  });
  const exitCode: number = await new Promise((r) => child.on('close', (c) => r(c ?? 0)));
  emitLive(buildId, { type: 'session_shell_end', iterationId: null, streamId: 'session', payload: { exitCode } });
  const transcript = `[user-shell] $ ${trimmed}\n${stdoutBuf}${stderrBuf ? `\n[stderr] ${stderrBuf}` : ''}`.slice(0, 4000);
  await emitLog(buildId, 'output', transcript);
}
