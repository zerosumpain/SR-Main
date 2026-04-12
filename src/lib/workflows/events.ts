import { EventEmitter } from 'events';
import type { WorkflowEvent } from './types';

const runEmitters = new Map<string, EventEmitter>();

export function getRunEmitter(runId: string): EventEmitter {
  let emitter = runEmitters.get(runId);
  if (!emitter) {
    emitter = new EventEmitter();
    emitter.setMaxListeners(20);
    runEmitters.set(runId, emitter);
  }
  return emitter;
}

export function emitWorkflowEvent(event: WorkflowEvent): void {
  const emitter = runEmitters.get(event.runId);
  if (emitter) {
    emitter.emit('workflow', event);
  }
}

export function onWorkflowEvent(
  runId: string,
  handler: (event: WorkflowEvent) => void,
): () => void {
  const emitter = getRunEmitter(runId);
  emitter.on('workflow', handler);
  return () => {
    emitter.off('workflow', handler);
    if (emitter.listenerCount('workflow') === 0) {
      runEmitters.delete(runId);
    }
  };
}

export function cleanupRunEmitter(runId: string): void {
  const emitter = runEmitters.get(runId);
  if (emitter) {
    emitter.removeAllListeners();
    runEmitters.delete(runId);
  }
}
