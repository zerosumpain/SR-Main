// src/lib/daydream/detectors/index.ts
//
// The detector registry, and the shared helpers they lean on.
//
// Every detector is a pure function over a snapshot. None of them calls a
// model, and none of them may — the model's job comes later, phrasing a finding
// that a rule already confirmed. The argument is the one the intel graph
// settled: a rule that fires on a measurable condition can be trusted,
// explained and tested, whereas asking a model what is interesting produces
// confident prose about things that are not there.

import { unknownPlace } from './unknown-place';
import { nearOpenThread } from './near-open-thread';
import { nearOffer } from './near-offer';
import { interestMeetsPlace } from './interest-meets-place';
import { contextMeetsHealth } from './context-meets-health';
import { freeWindow } from './free-window';
import { patternBreak } from './pattern-break';
import { correlationProbe } from './correlation-probe';
import { ruleDriven } from './rule-driven';
import type { Detector } from '../snapshot-types';

export const DETECTORS: Detector[] = [
  unknownPlace,
  nearOffer,
  contextMeetsHealth,
  nearOpenThread,
  interestMeetsPlace,
  freeWindow,
  patternBreak,
  correlationProbe,
  ruleDriven,
];

export function getDetector(kind: string): Detector | null {
  return DETECTORS.find((d) => d.kind === kind) ?? null;
}

export const DETECTOR_KINDS = DETECTORS.map((d) => d.kind);
