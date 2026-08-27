import type { ActivityHandler } from './types';
import { chatContinuation } from './activities/chat-continuation';
import { conversationCheckin } from './activities/conversation-checkin';
import { buildProgressCheck } from './activities/build-progress-check';
import { workflowReview } from './activities/workflow-review';
import { daydreamObserve } from './activities/daydream-observe';
import { daydreamFeatures } from './activities/daydream-features';
import { daydreamDigest } from './activities/daydream-digest';
import { daydreamExplore } from './activities/daydream-explore';
import { daydreamHypothesise } from './activities/daydream-hypothesise';
import { daydreamPlacesRefresh } from './activities/daydream-places';
import { daydreamSpendExtract } from './activities/daydream-spend';
import { daydreamSweep } from './activities/daydream-sweep';
import { daydreamSuggest } from './activities/daydream-suggest';
import { daydreamDetect } from './activities/daydream-detect';
import { daydreamCompose } from './activities/daydream-compose';
import { daydreamOffersScan } from './activities/daydream-offers';
import { daydreamRulesmith } from './activities/daydream-rulesmith';
import { daydreamBank } from './activities/daydream-bank';
import { daydreamIntelBridge } from './activities/daydream-intel';

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
  daydreamFeatures,
  daydreamDigest,
  daydreamExplore,
  daydreamHypothesise,
  daydreamPlacesRefresh,
  daydreamSpendExtract,
  daydreamSweep,
  daydreamSuggest,
  daydreamDetect,
  daydreamCompose,
  daydreamOffersScan,
  daydreamRulesmith,
  daydreamBank,
  daydreamIntelBridge,
];

const byName = new Map(handlers.map((h) => [h.name, h]));

export function getHandler(name: string): ActivityHandler | null {
  return byName.get(name) ?? null;
}

export function listHandlers(): ActivityHandler[] {
  return handlers.slice();
}
