// src/lib/trips/pack.server.ts
//
// v8: the research pack — the trip's places and date facts, found once when
// the trip starts, refreshed a week before, drawn on by every proposal, swap
// and idea (./decisions PackPlace, PackSummary).
//
// CONTRACT STUB (2026-10-21): the signature other modules call. The
// research work replaces the body.

import type { TripRecord } from './store.server';

/**
 * Make sure the trip has a pack: start a build when there is none (or the
 * destination or dates changed), a refresh when the trip is a week away and
 * the pack is older than that. Returns at once; the build runs as a job.
 */
export async function ensurePack(_trip: TripRecord, _opts: { reason?: 'created' | 'changed' | 'read' } = {}): Promise<void> {}
