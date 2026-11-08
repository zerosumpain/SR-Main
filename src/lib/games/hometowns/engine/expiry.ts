// A forgotten county (spec §20 A40, decided default): nobody's hello for 90
// days stops the weekly nap heartbeat, and the row then expires under the
// framework's 30-day abandoned rule, so a county is deleted about 120 days
// after its last visit. From day 60 the lobby says so ("Kingsport County is
// fast asleep. Visit to keep it"). This is the engine's one pure answer to
// "how close is this county to expiring?", for the adapter's heartbeat and
// lobby summary; it never changes the county.

import { MS_DAY } from './clock';
import { paramsFor } from './params';
import { regionParams } from './region-params';
import type { CountyState } from './types';

export interface Expiry {
  /** Whole days since any mayor's hello. */
  daysQuiet: number;
  /** 'awake'; 'warn' from 60 days (the lobby warns); 'stopped' from 90 (no more heartbeats). */
  stage: 'awake' | 'warn' | 'stopped';
  /** The instant the heartbeats stop, and the instant the row is expected to be deleted. */
  heartbeatsStopAt: number;
  deleteAt: number;
}

export function countyExpiry(c: CountyState, now: number): Expiry {
  const p = paramsFor(c.paramsVersion);
  const q = regionParams(c.paramsVersion);
  const quiet = Math.max(0, now - c.lastHelloAt);
  const daysQuiet = Math.floor(quiet / MS_DAY);
  const heartbeatsStopAt = c.lastHelloAt + p.social.napHeartbeatMaxDays * MS_DAY;
  const deleteAt = heartbeatsStopAt + q.expiryAbandonedDays * MS_DAY;
  const stage = now >= heartbeatsStopAt ? 'stopped' : daysQuiet >= q.expiryWarnDays ? 'warn' : 'awake';
  return { daysQuiet, stage, heartbeatsStopAt, deleteAt };
}
