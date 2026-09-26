import type { ActivityHandler } from './types';
import { chatContinuation } from './activities/chat-continuation';
import { conversationCheckin } from './activities/conversation-checkin';
import { buildProgressCheck } from './activities/build-progress-check';
import { workflowReview } from './activities/workflow-review';
import { homeObserve } from './activities/home-observe';
import { householdLive } from './activities/household-live';
import { daydreamFeatures } from './activities/daydream-features';
import { homePlaces } from './activities/home-places';
import { daydreamAppetite } from './activities/daydream-appetite';
import { daydreamBank } from './activities/daydream-bank';
import { daydreamDoctor } from './activities/daydream-doctor';
import { daydreamNotebook } from './activities/daydream-notebook';
import { daydreamThink } from './activities/daydream-think';
import { daydreamMemory } from './activities/daydream-memory';
import { daydreamImprove } from './activities/daydream-improve';
import { activitySync } from './activities/activity-sync';
import { alexaSignalsSync, alexaVoiceSync, alexaVoiceTopics } from './activities/alexa-voice';
import { newsBrief } from './activities/news-brief';

/**
 * The full set of available heartbeat activity handlers. The engine looks
 * up each row in heartbeat_activities by name; rows whose name doesn't
 * appear here are skipped with a 'skipped' outcome ("no handler").
 */
const handlers: ActivityHandler[] = [
  newsBrief,
  chatContinuation,
  conversationCheckin,
  buildProgressCheck,
  workflowReview,
  homeObserve,
  householdLive,
  daydreamFeatures,
  homePlaces,
  daydreamAppetite,
  daydreamBank,
  daydreamDoctor,
  daydreamNotebook,
  daydreamThink,
  daydreamMemory,
  daydreamImprove,
  activitySync,
  alexaVoiceSync,
  alexaSignalsSync,
  alexaVoiceTopics,
];

const byName = new Map(handlers.map((h) => [h.name, h]));

export function getHandler(name: string): ActivityHandler | null {
  return byName.get(name) ?? null;
}

export function listHandlers(): ActivityHandler[] {
  return handlers.slice();
}
