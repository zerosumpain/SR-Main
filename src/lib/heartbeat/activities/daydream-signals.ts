import { getSetting } from '$lib/server/models/settings';
import { harvestHomeAssistant } from '$lib/daydream/signals/ha';
import { buildJourneySignals } from '$lib/daydream/signals/journeys';
import { mirrorFeatures } from '$lib/daydream/signals/mirror';
import { backfillWeather } from '$lib/daydream/signals/weather';
import { buildGraphSignals } from '$lib/daydream/signals/graph';
import { harvestToolSignals, registerHarvest, retireBarrenToolSignals } from '$lib/daydream/signals/tools';
import { recordObservations, refreshSignalStats } from '$lib/daydream/signals/registry';
import { localDay } from '$lib/daydream/features/build';
import { SETTINGS_ENABLED_KEY } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-signals';

interface SignalsConfig {
  /** How far back to mirror the feature store. Cheap and idempotent, so the
   *  default covers the whole store rather than a trailing window. */
  mirrorWindowDays?: number;
  /** Read Home Assistant. Off would leave the house undiscovered; it exists so
   *  a misbehaving source can be stopped without stopping the action. */
  harvestHa?: boolean;
  /** How far back to re-derive journeys. Bounded by trail retention anyway. */
  journeyWindowDays?: number;
  /** How far back to recompute the graph's daily activity. The source rows
   *  carry their own timestamps, so this is a cheap grouped count and the
   *  series arrive already old enough to be swept. */
  graphWindowDays?: number;
  /** Sample the self-built custom tools that take no arguments and turn the
   *  numbers they return into signals. Off would leave the self-improvement
   *  engine's output where it has been all along: nowhere. */
  harvestTools?: boolean;
  /** Trailing days of weather to (re)fetch each run. Small by default: the
   *  archive does not revise itself, so re-pulling a year nightly would be a
   *  free service being leaned on for nothing. Backfill runs separately. */
  weatherDays?: number;
}

const DEFAULTS: Required<SignalsConfig> = {
  mirrorWindowDays: 400,
  harvestHa: true,
  harvestTools: true,
  journeyWindowDays: 30,
  weatherDays: 7,
  graphWindowDays: 120,
};

/**
 * Discover every series daydream can reach, and fold today's readings into it.
 *
 * Hourly, and modelled on `heartbeat/auto-register.ts`: enumerate, register what
 * is new, leave everything else alone. Nothing in this action names an entity.
 * That is the point — the day Home Assistant starts answering for a device it
 * previously could not, its readings begin accumulating because it answered,
 * not because anyone deployed.
 *
 * Hourly rather than at the two-minute trail cadence because a house does not
 * change fast enough to justify 415 readings every two minutes, and twenty-four
 * samples a day is plenty to characterise one. The store folds them into a
 * running mean with min, max and last alongside.
 *
 * Registering is not trusting: a signal joins a sweep only once it has enough
 * observed days to clear MIN_PAIRS, so a sensor found this morning is silent
 * for a fortnight rather than immediately contributing noise to a
 * false-discovery correction.
 *
 * No LLM.
 */
export const daydreamSignalsRefresh: ActivityHandler = {
  name: NAME,
  description:
    'Discovers every measurable series daydream can reach — every Home Assistant entity state and numeric attribute, the feature store, journeys, weather and the knowledge graph\'s daily activity, republished as signals — registers anything new, and folds this hour\'s readings into today. Nothing here names an entity, so a device that starts answering starts being pondered with no deploy. No LLM.',
  defaultCadenceSeconds: 3600,
  defaultEnabled: true,
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as SignalsConfig) };

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    const notes: string[] = [];
    const details: Record<string, unknown> = {};

    // ── the house ────────────────────────────────────────────────────────
    let haReadings = 0;
    let haRegistered = 0;
    if (cfg.harvestHa) {
      const ha = await harvestHomeAssistant();
      if (ha.ok) {
        const day = localDay(new Date());
        haReadings = await recordObservations(day, ha.readings);
        haRegistered = ha.specs.length;
        notes.push(`${ha.entities} entities → ${haReadings} readings`);
        if (ha.unavailable) notes.push(`${ha.unavailable} unavailable`);
        details.ha = {
          entities: ha.entities,
          offered: ha.specs.length,
          readings: haReadings,
          unavailable: ha.unavailable,
        };
      } else {
        // Home Assistant lives on the home LAN and production does not. An
        // unreachable house is an ordinary Tuesday, so it is reported and does
        // NOT fail the action — the same call the trail's poll floor makes.
        notes.push(`HA unreachable (${ha.error})`);
        details.ha = { error: ha.error };
      }
    }

    // ── the tools the engine wrote for itself ────────────────────────────
    //
    // The loop this closes: self-improvement ships a tool, and until now
    // nothing ever called it — 33 shipped in the fortnight to 2026-08-30, 0
    // ever called. Sampled daily they become ordinary signals, join the sweep
    // at MIN_PAIRS and reach the ponder pack.
    if (cfg.harvestTools) {
      const tools = await harvestToolSignals();
      if (tools.sampled > 0) {
        const { registered } = await registerHarvest(tools);
        const day = localDay(new Date());
        const readings = await recordObservations(day, tools.readings);
        const retired = await retireBarrenToolSignals();
        notes.push(`${tools.sampled} self-built tool(s) → ${readings} reading(s)`);
        if (tools.failed.length) notes.push(`${tools.failed.length} tool(s) failed`);
        details.tools = {
          sampled: tools.sampled,
          registered,
          readings,
          // Named, not just counted: a tool that returns nothing numeric is a
          // tool worth deleting, and a count alone never says which.
          barren: tools.barren,
          failed: tools.failed,
          retired: retired.ignored,
        };
      }
    }

    // ── the feature store, republished ───────────────────────────────────
    const mirrored = await mirrorFeatures({ windowDays: cfg.mirrorWindowDays });
    notes.push(`${mirrored.days} feature days mirrored`);
    details.mirror = mirrored;

    // ── the moving half of the trail ─────────────────────────────────────
    const journeys = await buildJourneySignals({ windowDays: cfg.journeyWindowDays });
    notes.push(`${journeys.journeys} journeys over ${journeys.days} person-days`);
    if (journeys.routes) notes.push(`${journeys.routes} recurring routes`);
    details.journeys = journeys;

    // ── weather, where each person actually was ──────────────────────────
    if (cfg.weatherDays > 0) {
      const weather = await backfillWeather({ days: cfg.weatherDays });
      notes.push(`weather: ${weather.subjectDays} person-days in ${weather.requested} requests`);
      details.weather = weather;
      // Reported, never fatal — a free third-party API being unreachable is not
      // a reason to fail the action that also discovers the house.
      if (weather.errors.length) notes.push(`weather errors: ${weather.errors.length}`);
    }

    // ── the knowledge graph's daily activity ─────────────────────────────
    // Rates, never cumulative totals: a monotonic series rank-correlates with
    // everything that trends, and the sweep's default is Spearman. See
    // signals/graph.ts. NOT added to SWEEP_METRICS — the registry feeds the
    // sweep, the proposer's vocabulary stays fixed.
    if (cfg.graphWindowDays > 0) {
      const graph = await buildGraphSignals({ windowDays: cfg.graphWindowDays });
      notes.push(`graph: ${graph.signals} signals over ${graph.days} days`);
      details.graph = graph;
      if (graph.errors.length) notes.push(`graph errors: ${graph.errors.length}`);
    }

    const refreshed = await refreshSignalStats();
    details.signalsRefreshed = refreshed;

    return {
      outcome: 'ok',
      summary: notes.join('; ') || 'nothing to discover',
      details: { ...details, haRegistered },
    };
  },
};
