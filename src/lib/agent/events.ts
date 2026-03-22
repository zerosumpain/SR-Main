import { EventEmitter } from 'events';

export interface ActivityEvent {
  id: number;
  actionId: string | null;
  taskId: string | null;
  eventType: string;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

// Global emitter for live activity feed
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function emitActivity(event: ActivityEvent) {
  emitter.emit('activity', event);
}

export function onActivity(handler: (event: ActivityEvent) => void) {
  emitter.on('activity', handler);
  return () => emitter.off('activity', handler);
}
