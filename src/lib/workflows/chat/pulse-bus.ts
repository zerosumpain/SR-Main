import type { PulseEvent } from '$lib/db/schema';

type Listener = (event: PulseEvent) => void;
const listeners = new Set<Listener>();

export function publishPulseEvent(event: PulseEvent): void {
  for (const fn of listeners) {
    try { fn(event); } catch { /* ignore broken listener */ }
  }
}

export function subscribePulse(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
