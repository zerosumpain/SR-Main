import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import {
  loadBudget,
  loadCounts,
  loadDelivery,
  loadDetectorRows,
  loadEngineState,
  loadRules,
  loadTelemetry,
  type DetectorRow,
  type EngineState,
} from '$lib/daydream/ledger';
import { loadProvenance } from '$lib/daydream/provenance';
import { loadJobSchedules, type JobSchedule } from '$lib/daydream/rooms/engine.server';

// The engine room reads only what the engine room draws: the state, the
// detectors, the budget, the rules, the counts, the telemetry, the delivery
// facts and the provenance measurement. The hub counts on the rail come from
// the layout, so nothing here is loaded twice.
//
// Every read tolerates the tables being empty — on a fresh install they are —
// and the catch branch returns the SAME KEYS, because a key present on only
// one branch is a property the page's union type does not have.

export const load: PageServerLoad = async () => {
  try {
    const [engine, detectors, budget, rules, counts, telemetry, delivery, provenance, schedules] =
      await Promise.all([
        loadEngineState(),
        loadDetectorRows(),
        loadBudget(),
        loadRules(),
        loadCounts(),
        loadTelemetry(),
        loadDelivery(),
        loadProvenance(),
        loadJobSchedules(),
      ]);
    return {
      engine,
      detectors,
      budget,
      rules,
      counts,
      telemetry,
      delivery,
      provenance,
      schedules,
      loadError: null,
    };
  } catch (err) {
    console.error('[daydream] engine load failed:', errMsg(err));
    const engine: EngineState = {
      lastDetectAt: null,
      lastObserveAt: null,
      coverage: null,
      trailSpanDays: null,
      sources: [],
      pausedActions: [],
      summary: null,
    };
    const detectors: DetectorRow[] = [];
    const rules: Awaited<ReturnType<typeof loadRules>> = [];
    const schedules: JobSchedule[] = [];
    const counts: Awaited<ReturnType<typeof loadCounts>> = {
      byStatus: {},
      places: 0,
      namedPlaces: 0,
      unnamedPlaces: 0,
      thoughts7d: 0,
    };
    const provenance: Awaited<ReturnType<typeof loadProvenance>> = {
      sources: [],
      minPairs: 0,
      registered: 0,
      sweepable: 0,
    };
    return {
      engine,
      detectors,
      budget: null as Awaited<ReturnType<typeof loadBudget>>,
      rules,
      counts,
      telemetry: null as Awaited<ReturnType<typeof loadTelemetry>> | null,
      delivery: null as Awaited<ReturnType<typeof loadDelivery>> | null,
      provenance,
      schedules,
      loadError: errMsg(err),
    };
  }
};
