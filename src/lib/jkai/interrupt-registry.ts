/**
 * Tracks the currently-running pi child process for each active build so
 * the WebSocket inbound `interrupt` handler can SIGTERM it. The pi-runner
 * registers on spawn and unregisters on exit.
 *
 * In-process Map only — interrupts are best-effort and bound to the
 * current builder process. After a builder restart the in-flight pi is
 * already gone, so an interrupt after restart is a no-op.
 */
import type { ChildProcess } from 'node:child_process';

const active = new Map<string, ChildProcess>();

export function registerActiveChild(buildId: string, child: ChildProcess): void {
  active.set(buildId, child);
}

export function clearActiveChild(buildId: string, child: ChildProcess): void {
  if (active.get(buildId) === child) active.delete(buildId);
}

/** SIGTERM whatever pi child is currently running for this build, if any.
 *  Returns true if a child was signalled. */
export function interruptActiveChild(buildId: string): boolean {
  const child = active.get(buildId);
  if (!child) return false;
  try { child.kill('SIGTERM'); return true; } catch { return false; }
}
