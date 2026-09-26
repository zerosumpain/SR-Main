import type { ActivityHandler } from './types';
import { chatContinuation } from './activities/chat-continuation';
import { conversationCheckin } from './activities/conversation-checkin';
import { buildProgressCheck } from './activities/build-progress-check';
import { workflowReview } from './activities/workflow-review';
import { homeObserve } from './activities/home-observe';
import { daydreamFeatures } from './activities/daydream-features';
import { daydreamDigest } from './activities/daydream-digest';
import { daydreamExplore } from './activities/daydream-explore';
import { daydreamHypothesise } from './activities/daydream-hypothesise';
import { homePlaces } from './activities/home-places';
import { daydreamSignalsRefresh } from './activities/daydream-signals';
import { daydreamSpendExtract } from './activities/daydream-spend';
import { daydreamSweep } from './activities/daydream-sweep';
import { daydreamDetect } from './activities/daydream-detect';
import { daydreamCompose } from './activities/daydream-compose';
import { daydreamOffersScan } from './activities/daydream-offers';
import { daydreamRulesmith } from './activities/daydream-rulesmith';
import { daydreamAppetite } from './activities/daydream-appetite';
import { daydreamBank } from './activities/daydream-bank';
import { daydreamDoctor } from './activities/daydream-doctor';
import { daydreamIntelBridge } from './activities/daydream-intel';
import { daydreamMail } from './activities/daydream-mail';
import { daydreamNotebook } from './activities/daydream-notebook';
import { daydreamPonder } from './activities/daydream-ponder';
import { daydreamThink } from './activities/daydream-think';
import { daydreamMemory } from './activities/daydream-memory';
import { daydreamImprove } from './activities/daydream-improve';
import { daydreamReview } from './activities/daydream-review';
import { daydreamWeekly } from './activities/daydream-weekly';
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
  daydreamFeatures,
  daydreamDigest,
  daydreamExplore,
  daydreamHypothesise,
  homePlaces,
  daydreamSignalsRefresh,
  daydreamSpendExtract,
  daydreamSweep,
  daydreamDetect,
  daydreamCompose,
  daydreamOffersScan,
  daydreamMail,
  daydreamRulesmith,
  daydreamAppetite,
  daydreamBank,
  daydreamDoctor,
  daydreamIntelBridge,
  daydreamNotebook,
  daydreamPonder,
  daydreamThink,
  daydreamMemory,
  daydreamImprove,
  daydreamReview,
  daydreamWeekly,
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
