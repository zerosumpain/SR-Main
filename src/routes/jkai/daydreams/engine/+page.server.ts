import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import {
  loadBudget,
  loadCounts,
  loadDelivery,
  loadDetectorRows,
  loadRules,
  loadTelemetry,
  type DetectorRow,
  type EngineState,
} from '$lib/daydream/ledger';
import { loadProvenance } from '$lib/daydream/provenance';
import { loadDeliveryStats, loadJobSchedules, type DeliveryStats, type JobSchedule } from '$lib/daydream/rooms/engine.server';
import { loadRoutes } from '$lib/daydream/routes.server';
import type { RouteOverrides } from '$lib/daydream/routes';

// The engine room reads only what the engine room draws: the state, the
// detectors, the budget, the rules, the counts, the telemetry, the delivery
// facts and the provenance measurement. The hub counts on the rail come from
// the layout, so nothing here is loaded twice.
//
// Every read tolerates the tables being empty — on a fresh install they are —
// and the catch branch returns the SAME KEYS, because a key present on only
// one branch is a property the page's union type does not have.

export const load: PageServerLoad = async ({ parent }) => {
  try {
    // `engine` is already on the layout (`counts.engine`) — read it from there
    // rather than running the same pulse queries a second time.
    const [
      { counts: hub },
      detectors,
      budget,
      rules,
      counts,
      telemetry,
      delivery,
      provenance,
      schedules,
      routes,
      deliveryStats,
    ] = await Promise.all([
      parent(),
      loadDetectorRows(),
      loadBudget(),
      loadRules(),
      loadCounts(),
      loadTelemetry(),
      loadDelivery(),
      loadProvenance(),
      loadJobSchedules(),
      loadRoutes(),
      loadDeliveryStats(),
    ]);
    const engine = hub.engine;
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
      routes,
      deliveryStats,
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
    // Same keys on both branches: a key present on only one is a property the
    // page's union type does not have. An empty override map is a real value —
    // it means "every route is still the default" — so it is `{}`, not null.
    const routes: RouteOverrides = {};
    const deliveryStats: DeliveryStats | null = null;
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
      routes,
      deliveryStats,
      loadError: errMsg(err),
    };
  }
};
