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
import { daydreamSignalsRefresh } from './activities/daydream-signals';
import { daydreamSpendExtract } from './activities/daydream-spend';
import { daydreamSweep } from './activities/daydream-sweep';
import { daydreamSuggest } from './activities/daydream-suggest';
import { daydreamDetect } from './activities/daydream-detect';
import { daydreamCompose } from './activities/daydream-compose';
import { daydreamOffersScan } from './activities/daydream-offers';
import { daydreamRulesmith } from './activities/daydream-rulesmith';
import { daydreamBank } from './activities/daydream-bank';
import { daydreamIntelBridge } from './activities/daydream-intel';
import { daydreamMail } from './activities/daydream-mail';
import { daydreamNotebook } from './activities/daydream-notebook';
import { daydreamPonder } from './activities/daydream-ponder';
import { daydreamMemory } from './activities/daydream-memory';
import { daydreamImprove } from './activities/daydream-improve';
import { daydreamReview } from './activities/daydream-review';
import { daydreamWeekly } from './activities/daydream-weekly';
import { geoTerritory } from './activities/geo-territory';

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
  daydreamSignalsRefresh,
  daydreamSpendExtract,
  daydreamSweep,
  daydreamSuggest,
  daydreamDetect,
  daydreamCompose,
  daydreamOffersScan,
  daydreamMail,
  daydreamRulesmith,
  daydreamBank,
  daydreamIntelBridge,
  daydreamNotebook,
  daydreamPonder,
  daydreamMemory,
  daydreamImprove,
  daydreamReview,
  daydreamWeekly,
  geoTerritory,
];

const byName = new Map(handlers.map((h) => [h.name, h]));

export function getHandler(name: string): ActivityHandler | null {
  return byName.get(name) ?? null;
}

export function listHandlers(): ActivityHandler[] {
  return handlers.slice();
}
