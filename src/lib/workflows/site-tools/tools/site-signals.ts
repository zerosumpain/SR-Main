// Read-only "live site signals" toolset — surfaces three data surfaces the
// assistant was previously blind to: the live GPS walk/ride state (/live),
// current family presence (/live map), and the DfE policy-engine tracking
// indicators (/monitor). All three read the data layer directly (no internal
// HTTP), mirroring the health/diagnostics tools' pattern.

import { register } from '../registry-internal';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

// Mirrors /api/live-walk + /api/landing/vitals.
const LIVE_STATE_PATH = '/tmp/live-walk-state.json';
const WALK_EXPIRE_MS = 4 * 60 * 60 * 1000;

// The workflow that owns the family-presence data-store keys (set by the
// presence-tracking workflow). Same id used by /api/family-presence/stats.
const FAMILY_PRESENCE_WORKFLOW_ID = '75bd5bc5-3297-4509-956e-3851b3811491';

register({
  name: 'live_walk_status',
  description:
    "Current live GPS walk/ride status from John's phone: whether a walk or ride is in progress right now, the route name and type, distance covered so far, elapsed time, and elevation gain. Returns { active: false } when nothing is live. Use for 'is John out / on a walk?', 'how far has he gone?'.",
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Live Signals',
  toolset: 'site-signals',
  handler: async () => {
    try {
      if (!existsSync(LIVE_STATE_PATH)) return { success: true, data: { active: false } };
      const s = JSON.parse(await readFile(LIVE_STATE_PATH, 'utf-8'));
      if (!s?.receivedAt || Date.now() - s.receivedAt > WALK_EXPIRE_MS) {
        return { success: true, data: { active: false } };
      }
      if (s.status === 'finished') return { success: true, data: { active: false, status: 'finished' } };
      return {
        success: true,
        data: {
          active: true,
          status: s.status ?? 'active',
          routeName: typeof s.routeName === 'string' ? s.routeName : null,
          routeType: s.routeType ?? null,
          routeDistanceKm: typeof s.routeDistanceKm === 'number' ? s.routeDistanceKm : null,
          distanceKm: typeof s.stats?.distanceKm === 'number' ? s.stats.distanceKm : null,
          durationMs: typeof s.stats?.durationMs === 'number' ? s.stats.durationMs : null,
          avgSpeedKmh: typeof s.stats?.avgSpeedKmh === 'number' ? s.stats.avgSpeedKmh : null,
          elevationGainM:
            typeof s.stats?.elevationGainM === 'number' ? Math.round(s.stats.elevationGainM) : null,
          startedAt: s.startedAt ?? null,
          updatedAt: s.updatedAt ?? null,
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'failed to read live-walk state' };
    }
  },
});

register({
  name: 'family_presence_current',
  description:
    "Current family presence — who is home vs away right now and where each person was last seen (John, Katie, Fintan, Jemima, Rory). Reads the presence-tracking snapshot. Use for 'is anyone home?', 'where is Katie?', 'who's out?'. Read-only; per-person history is trimmed to keep the response compact.",
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Live Signals',
  toolset: 'site-signals',
  handler: async () => {
    const { getStoreValue } = await import('$lib/workflows/nodes/data-store');
    const { value, found } = await getStoreValue(FAMILY_PRESENCE_WORKFLOW_ID, 'family_presence_states');
    if (!found || value == null) {
      return { success: true, data: { available: false, note: 'No family-presence snapshot recorded yet.' } };
    }
    // Trim heavy per-person history to keep the payload bounded; keep the
    // current states / locations / trends the model actually needs.
    let compact: unknown = value;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const { history: _history, ...rest } = value as Record<string, unknown>;
      compact = rest;
    }
    return { success: true, data: compact };
  },
});

register({
  name: 'policy_engine_indicators',
  description:
    "DfE education policy-engine live-tracking indicators (the /monitor board): each tracked indicator's latest observed value vs the model's projected baseline and policy paths, on-track/off-track status, and data freshness. Use for 'how is the education model tracking vs real data?', 'which indicators are off-track?'. Read-only.",
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Live Signals',
  toolset: 'site-signals',
  handler: async () => {
    const { loadTrackedIndicators } = await import(
      '../../../../routes/projects/policy-engine/lib/tracking/ingest.server'
    );
    const indicators = await loadTrackedIndicators();
    const compact = indicators.map((i) => ({
      key: i.key,
      label: i.label,
      unit: i.unit,
      group: i.group,
      observedValue: i.observedValue,
      refPeriodLabel: i.refPeriodLabel,
      projectedBaseline: i.projectedBaseline,
      projectedPolicy: i.projectedPolicy,
      statusVsBaseline: i.statusVsBaseline,
      statusVsPolicy: i.statusVsPolicy,
      freshness: i.freshness,
      live: i.live,
      source: i.source?.name ?? null,
    }));
    return { success: true, data: { count: compact.length, indicators: compact } };
  },
});
