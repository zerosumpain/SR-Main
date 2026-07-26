// Overnight selection: load the OpenRouter catalogue, fold in first-time-correct
// history, and pick the best model per profile under the cost-aware policy.
import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { buildOpenWeightResolver } from '$lib/models/open-weights';
import { enrichRow, selectForProfile, type Candidate } from './scoring';
import { buildSuccessIndex, successForProfile } from './success';
import { listEvents } from './events';
import {
  PROFILES,
  type ModelProfile,
  type ModelAssignment,
  type RoutingAssignments,
  type RoutingConfig,
} from './types';

export interface SelectionResult {
  assignments: RoutingAssignments;
  candidateCounts: Partial<Record<ModelProfile, number>>;
  catalogueSize: number;
}

function buildReason(profile: ModelProfile, a: ModelAssignment): string {
  const bits: string[] = [];
  if (a.openWeights) bits.push('open weights');
  if (a.agenticIndex != null) bits.push(`agentic ${a.agenticIndex.toFixed(0)}`);
  if (a.blendedPerM != null) bits.push(`$${a.blendedPerM.toFixed(2)}/1M`);
  if (a.throughput != null) bits.push(`${a.throughput.toFixed(0)} t/s`);
  if (a.successSamples > 0 && a.successRate != null) bits.push(`${Math.round(a.successRate * 100)}% first-try (n=${a.successSamples})`);
  return bits.join(' · ');
}

/** Run the per-profile selection over the current catalogue + success history.
 *  Pure of side effects (no persistence) — callers persist the result. */
export async function selectModels(config: RoutingConfig): Promise<SelectionResult> {
  const rows = await db.select().from(openrouterModels);
  // Built over the whole catalogue — a hosted variant inherits its base model's
  // open-weight status, so glm-5-turbo & co. keep the open-weight bonus.
  const openWeights = buildOpenWeightResolver(rows);
  const candidates: Candidate[] = rows.map((row) => enrichRow(row, openWeights));

  const events = await listEvents();
  const successIndex = buildSuccessIndex(events);

  const assignments: RoutingAssignments = {};
  const candidateCounts: Partial<Record<ModelProfile, number>> = {};

  for (const profile of PROFILES) {
    const { winner, poolSize } = selectForProfile(candidates, {
      weights: config.weights[profile],
      qualityFloorFrac: config.qualityFloorFrac[profile],
      priceCeilingPerM: config.priceCeilingPerM,
      minContext: config.minContext,
      successBiasK: config.successBiasK,
      openWeightBonus: config.openWeightBonus,
      openWeightsOnly: config.openWeightsOnly,
      successFor: successForProfile(successIndex, profile),
    });
    candidateCounts[profile] = poolSize;
    if (!winner) continue;
    const assignment: ModelAssignment = {
      profile,
      modelId: winner.id,
      modelName: winner.name,
      score: winner.finalScore,
      hybridScore: winner.hybridScore,
      blendedPerM: winner.blendedPerM,
      agenticIndex: winner.agenticIndex,
      throughput: winner.throughput,
      successRate: winner.successRate,
      successSamples: winner.successSamples,
      openWeights: winner.openWeights,
      reason: '',
    };
    assignment.reason = buildReason(profile, assignment);
    assignments[profile] = assignment;
  }

  return { assignments, candidateCounts, catalogueSize: rows.length };
}
