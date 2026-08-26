import type { ActivityHandler } from './types';
import { chatContinuation } from './activities/chat-continuation';
import { conversationCheckin } from './activities/conversation-checkin';
import { buildProgressCheck } from './activities/build-progress-check';
import { workflowReview } from './activities/workflow-review';
import { daydreamObserve } from './activities/daydream-observe';
import { daydreamPlacesRefresh } from './activities/daydream-places';

/**
 * The full set of available heartbeat activity handlers. The engine looks
 * up each row in heartbeat_activities by name; rows whose name doesn't
 * appear here are skipped with a 'skipped' outcome ("no handler").
 */
const handlers: ActivityHandler[] = [
  chatContinuation,
  conversationCheckin,
  buildProgressCheck,
  workflowReview,
  daydreamObserve,
  daydreamPlacesRefresh,
];

const byName = new Map(handlers.map((h) => [h.name, h]));

export function getHandler(name: string): ActivityHandler | null {
  return byName.get(name) ?? null;
}

export function listHandlers(): ActivityHandler[] {
  return handlers.slice();
}
