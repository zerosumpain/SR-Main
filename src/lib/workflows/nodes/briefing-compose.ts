import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';

export { briefingComposeDef } from './briefing-compose.def';

type Obj = Record<string, unknown>;

export type SourceStatus = 'ok' | 'failed' | 'stale' | 'empty';

export interface BriefingSource {
  key: string;
  label: string;
  status: SourceStatus;
  /** Human-readable one-liner: the value when ok, the reason when not. */
  detail: string;
  error?: string | null;
}

export interface BriefingFact {
  section: string;
  label: string;
  /** Pre-formatted, unit-correct. The LLM may quote this and nothing else. */
  value: string;
  source: string;
}

export interface BriefingGap {
  section: string;
  reason: string;
}

const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** e.g. "Tue 29 Jul" */
function dateLabel(d: Date, timeZone: string): string {
  try {
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone });
  } catch {
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }
}

function hhmm(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone });
  } catch {
    return null;
  }
}

/** Whoop/Apple durations are milliseconds. Render as "6h 55m". */
function duration(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

/** One weather object → facts. Shared by the home and current-location blocks. */
function weatherFacts(section: string, w: Obj, sourceLabel: string): BriefingFact[] {
  const out: BriefingFact[] = [];
  const push = (label: string, value: string | null) => {
    if (value !== null) out.push({ section, label, value, source: sourceLabel });
  };
  const place = str(w.label);
  push('Place', place);
  const now = num(w.nowC);
  const feels = num(w.feelsLikeC);
  push(
    'Now',
    now !== null
      ? `${now}°C${feels !== null && Math.abs(feels - now) >= 2 ? ` (feels ${feels}°C)` : ''}, ${str(w.condition) ?? 'unknown conditions'}`
      : null,
  );
  const max = num(w.maxC);
  const min = num(w.minC);
  push('Today', max !== null && min !== null ? `${min}°C to ${max}°C, ${str(w.dayCondition) ?? 'unknown'}` : null);
  const pp = num(w.precipProbMaxPct);
  const mm = num(w.precipMm);
  push('Rain', pp !== null ? `${pp}% chance${mm !== null && mm > 0 ? `, ~${mm}mm` : ''}` : null);
  const wind = num(w.windKph);
  const gust = num(w.gustKph);
  push(
    'Wind',
    wind !== null
      ? `${Math.round(wind)} km/h ${str(w.windDir) ?? ''}`.trim() + (gust !== null ? `, gusts ${Math.round(gust)} km/h` : '')
      : null,
  );
  push('UV index', num(w.uvIndexMax) !== null ? String(num(w.uvIndexMax)) : null);
  const sr = str(w.sunrise);
  const ss = str(w.sunset);
  push('Daylight', sr && ss ? `${sr} – ${ss}` : null);
  const factors = Array.isArray(w.factors) ? (w.factors as unknown[]).filter((f): f is string => typeof f === 'string') : [];
  if (factors.length) push('Local factors', factors.join(' · '));
  return out;
}

export const briefingComposeExecutor: NodeExecutor = {
  type: 'briefing-compose',

  async execute(input: Obj, config: Obj, context: ExecutionContext): Promise<NodeResult> {
    const timezone = str(config.timezone) ?? 'Europe/London';
    const titlePrefix = str(config.titlePrefix) ?? 'Briefing';
    const now = new Date();

    const facts: BriefingFact[] = [];
    const gaps: BriefingGap[] = [];
    const sources: BriefingSource[] = [];

    // A gap means "this section produced no usable value", so only `failed` and
    // `empty` qualify. `stale` still yielded data (an old GPS fix, a partially
    // reporting sensor set) — calling that UNAVAILABLE would tell the LLM to
    // drop facts it legitimately has.
    const record = (key: string, label: string, status: SourceStatus, detail: string, error?: string | null) => {
      sources.push({ key, label, status, detail, error: error ?? null });
      if (status === 'failed' || status === 'empty') gaps.push({ section: label, reason: detail });
    };

    /** Ledger-only: the section row already raised the gap; this adds the real error. */
    const recordLedgerOnly = (key: string, label: string, detail: string, error?: string | null) => {
      sources.push({ key, label, status: 'failed', detail, error: error ?? null });
    };

    // ---- Location -------------------------------------------------------
    const loc = obj(input.location);
    const home = obj(loc?.home);
    const current = obj(loc?.current);
    let locationBlock: Obj | null = null;

    if (current && num(current.lat) !== null) {
      const isHome = current.isHome === true;
      const place = str(current.label) ?? (isHome ? 'Home' : 'an unknown place');
      const dist = num(current.distanceKm);
      const stale = current.stale === true;
      const age = num(current.ageMins);
      facts.push({
        section: 'Location',
        label: 'You are',
        value: isHome
          ? `at home (${str(home?.label) ?? 'Home'})`
          : `at ${place}${dist !== null ? `, ${dist} km ${str(current.bearing) ?? ''} of home`.trimEnd() : ''}`,
        source: str(current.entity) ?? 'home-assistant',
      });
      const since = hhmm(str(current.since), timezone);
      if (since) facts.push({ section: 'Location', label: 'Since', value: since, source: str(current.entity) ?? 'home-assistant' });
      const batt = num(current.batteryPct);
      if (batt !== null && batt <= 25) {
        facts.push({ section: 'Location', label: 'Phone battery', value: `${batt}%`, source: 'life360' });
      }
      locationBlock = { ...current, home };
      record(
        'location',
        'Location',
        stale ? 'stale' : 'ok',
        stale ? `position is ${age} min old (tracker not reporting)` : `${place}${dist !== null ? ` · ${dist} km from home` : ''}`,
      );
    } else {
      record('location', 'Location', 'failed', str(loc?.error) ?? 'no position available', str(loc?.error));
    }

    // ---- Weather (home + where you actually are) ------------------------
    const wHome = obj(input.weatherHome);
    const wHere = obj(input.weatherHere);
    const sameSpot = current?.isHome === true;

    if (wHome) {
      facts.push(...weatherFacts('Weather · home', wHome, 'open-meteo'));
      const max = num(wHome.maxC);
      record('weather-home', 'Weather · home', 'ok', `${str(wHome.condition) ?? '?'}${max !== null ? `, up to ${max}°C` : ''}`);
    } else {
      record('weather-home', 'Weather · home', 'failed', str(input.weatherHomeError) ?? 'no forecast returned');
    }

    if (sameSpot) {
      // Don't repeat the same forecast twice under two headings.
      record('weather-here', 'Weather · where you are', 'ok', 'same as home — you are at home');
    } else if (wHere) {
      facts.push(...weatherFacts('Weather · where you are', wHere, 'open-meteo'));
      const max = num(wHere.maxC);
      record(
        'weather-here',
        'Weather · where you are',
        'ok',
        `${str(wHere.label) ?? '?'} — ${str(wHere.condition) ?? '?'}${max !== null ? `, up to ${max}°C` : ''}`,
      );
      // The comparison is the point of having both.
      const hm = num(wHome?.maxC);
      const cm = num(wHere.maxC);
      if (hm !== null && cm !== null && Math.abs(cm - hm) >= 3) {
        facts.push({
          section: 'Weather · where you are',
          label: 'vs home',
          value: `${Math.abs(Math.round(cm - hm))}°C ${cm > hm ? 'warmer' : 'cooler'} than home today`,
          source: 'derived',
        });
      }
    } else {
      record('weather-here', 'Weather · where you are', 'failed', str(input.weatherHereError) ?? 'no forecast returned');
    }

    // ---- Sleep ----------------------------------------------------------
    const sleepRaw = obj(input.sleep);
    const sleep = obj(sleepRaw?.data)?.latest ? obj(obj(sleepRaw?.data)?.latest) : obj(sleepRaw?.latest);
    if (sleepRaw?.success === true && sleep) {
      const dur = duration(num(sleep.totalDuration));
      const perf = num(sleep.performance);
      if (dur) facts.push({ section: 'Sleep', label: 'Time in bed', value: dur, source: 'health' });
      if (perf !== null && perf > 0) facts.push({ section: 'Sleep', label: 'Performance', value: `${perf}%`, source: 'health' });
      const deep = num(sleep.deepPercent);
      const rem = num(sleep.remPercent);
      if (deep !== null && rem !== null && (deep > 0 || rem > 0)) {
        facts.push({ section: 'Sleep', label: 'Stages', value: `${deep}% deep, ${rem}% REM`, source: 'health' });
      }
      record('sleep', 'Sleep', dur ? 'ok' : 'empty', dur ? `${dur}${perf ? `, ${perf}% performance` : ''}` : 'no sleep recorded');
    } else {
      record('sleep', 'Sleep', 'failed', str(sleepRaw?.error) ?? 'no sleep data available', str(sleepRaw?.error));
    }

    // ---- Readiness ------------------------------------------------------
    const readyRaw = obj(input.readiness);
    const ready = obj(readyRaw?.data) ?? readyRaw;
    if (readyRaw?.success === true && ready) {
      const score = num(ready.score) ?? num(ready.readiness);
      const zone = str(ready.zone);
      if (score !== null) facts.push({ section: 'Readiness', label: 'Score', value: `${Math.round(score)}${zone ? ` (${zone})` : ''}`, source: 'health' });
      const rec = str(ready.recommendation);
      if (rec) facts.push({ section: 'Readiness', label: 'Recommendation', value: rec, source: 'health' });
      record('readiness', 'Readiness', score !== null ? 'ok' : 'empty', score !== null ? `${Math.round(score)}${zone ? ` · ${zone}` : ''}` : 'no score');
    } else {
      record('readiness', 'Readiness', 'failed', str(readyRaw?.error) ?? 'no readiness data available', str(readyRaw?.error));
    }

    // ---- Indoor sensors -------------------------------------------------
    const indoorRaw = obj(input.indoor);
    const entities = Array.isArray(indoorRaw?.entities) ? (indoorRaw.entities as unknown[]) : [];
    const live = entities.map(obj).filter((e): e is Obj => !!e && str(e.state) !== null && !['unavailable', 'unknown'].includes(String(e.state)));
    const dead = entities.map(obj).filter((e): e is Obj => !!e && (str(e.error) !== null || ['unavailable', 'unknown'].includes(String(e.state))));
    if (live.length) {
      for (const e of live) {
        const unit = str(obj(e.attributes)?.unit_of_measurement) ?? '';
        facts.push({
          section: 'Home',
          label: str(e.friendly_name) ?? str(e.entity_id) ?? 'Sensor',
          value: `${e.state}${unit}`,
          source: str(e.entity_id) ?? 'home-assistant',
        });
      }
      record(
        'indoor',
        'Indoor sensors',
        dead.length ? 'stale' : 'ok',
        dead.length
          ? `${live.length} reporting, ${dead.length} unavailable (${dead.map((d) => str(d.entity_id) ?? '?').join(', ')})`
          : `${live.length} sensor${live.length === 1 ? '' : 's'} reporting`,
      );
    } else {
      record(
        'indoor',
        'Indoor sensors',
        'failed',
        entities.length ? `all ${entities.length} configured sensors are unavailable` : 'no sensors returned',
      );
    }

    // ---- Email ----------------------------------------------------------
    const emailRaw = obj(input.email);
    const messages = Array.isArray(emailRaw?.messages)
      ? (emailRaw.messages as unknown[])
      : Array.isArray(emailRaw?.results)
        ? (emailRaw.results as unknown[])
        : null;
    if (messages) {
      const count = num(emailRaw?.count) ?? messages.length;
      facts.push({ section: 'Email', label: 'Unread since last night', value: String(count), source: 'gmail' });
      const subjects = messages
        .map(obj)
        .map((m) => str(m?.subject) ?? str(m?.snippet))
        .filter((s): s is string => !!s)
        .slice(0, 5);
      subjects.forEach((s, i) => facts.push({ section: 'Email', label: `Message ${i + 1}`, value: s, source: 'gmail' }));
      record('email', 'Email', count === 0 ? 'empty' : 'ok', count === 0 ? 'nothing new' : `${count} unread`);
    } else {
      record('email', 'Email', 'failed', str(emailRaw?.error) ?? 'Gmail did not return results', str(emailRaw?.error));
    }

    // ---- Knowledge graph ------------------------------------------------
    const knowRaw = obj(input.knowledge);
    const intelContext = str(knowRaw?.intelContext);
    if (intelContext) {
      facts.push({ section: 'Knowledge graph', label: 'Related context', value: intelContext.slice(0, 1500), source: 'intel' });
      record('knowledge', 'Knowledge graph', 'ok', `context for "${str(knowRaw?.intelQuery) ?? 'today'}"`);
    } else {
      record('knowledge', 'Knowledge graph', 'empty', 'no matching entities in the graph');
    }

    // ---- Source ledger from the run itself ------------------------------
    // A namespaced key only exists when its branch succeeded; a node that
    // failed leaves no trace in the merged payload, so "absent" and "broken"
    // look identical here. Walk the upstream graph and ask the engine what
    // each ancestor actually did, so a real failure is never recorded as a
    // benign gap. Node executions are not in the DB yet — the run is still
    // in flight — which is why this reads the live engine state.
    if (config.auditRun !== false && context.getNodeError && context._currentNodeId) {
      try {
        const seen = new Set<string>();
        const queue = [context._currentNodeId];
        while (queue.length) {
          const id = queue.shift() as string;
          for (const edge of context.getIncomingEdges(id)) {
            const src = edge.sourceNodeId;
            if (seen.has(src)) continue;
            seen.add(src);
            queue.push(src);
            const err = context.getNodeError(src);
            if (!err) continue;
            const meta = context.getNodeConfig(src);
            const key = `node:${meta?.type ?? src}`;
            if (sources.some((s) => s.key === key)) continue;
            recordLedgerOnly(key, meta?.label || meta?.type || 'Upstream node', err, err);
          }
        }
      } catch {
        // The ledger is an enrichment — never fail the briefing over it.
      }
    }

    // ---- Rendered sheets for the LLM ------------------------------------
    const sections = [...new Set(facts.map((f) => f.section))];
    const factSheet = sections
      .map((s) => `[${s}]\n` + facts.filter((f) => f.section === s).map((f) => `  ${f.label}: ${f.value}`).join('\n'))
      .join('\n\n');
    const gapSheet = gaps.length
      ? gaps.map((g) => `  ${g.section}: UNAVAILABLE — ${g.reason}`).join('\n')
      : '  (none — every source reported)';

    // A deterministic headline, so there is always a true summary line even if
    // the LLM step is skipped or fails.
    const headlineBits: string[] = [];
    const hereW = sameSpot ? wHome : wHere;
    if (current) headlineBits.push(current.isHome === true ? 'At home' : `In ${str(current.label) ?? 'transit'}`);
    if (hereW) {
      const mx = num(hereW.maxC);
      headlineBits.push(`${str(hereW.condition) ?? 'weather unknown'}${mx !== null ? `, up to ${mx}°C` : ''}`);
    }
    const headline = headlineBits.join(' · ') || 'Briefing';

    const briefing = {
      date: now.toISOString().slice(0, 10),
      dateLabel: dateLabel(now, timezone),
      title: `${titlePrefix} — ${dateLabel(now, timezone)}`,
      generatedAt: now.toISOString(),
      timezone,
      headline,
      location: locationBlock,
      weather: { home: wHome, here: sameSpot ? null : wHere, sameSpot },
      knowledge: intelContext ? { query: str(knowRaw?.intelQuery), context: intelContext } : null,
    };

    return {
      output: {
        briefing,
        facts,
        gaps,
        sources,
        factSheet,
        gapSheet,
        headline,
        availableCount: sources.filter((s) => s.status === 'ok').length,
        gapCount: gaps.length,
      },
      rowCount: facts.length,
    };
  },

  getInputSchema() {
    return {
      type: 'object',
      description:
        'Merged signals. Recognised keys: location, weatherHome, weatherHere, sleep, readiness, indoor, email, knowledge.',
    };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        briefing: { type: 'object', description: 'Structured briefing: date, title, headline, location, weather, knowledge' },
        facts: { type: 'array', description: '[{ section, label, value, source }] — every value the briefing may state' },
        gaps: { type: 'array', description: '[{ section, reason }] — sources that produced nothing' },
        sources: { type: 'array', description: '[{ key, label, status, detail, error }] — the audit ledger' },
        factSheet: { type: 'string', description: 'Rendered FACTS block for the LLM prompt' },
        gapSheet: { type: 'string', description: 'Rendered GAPS block for the LLM prompt' },
        headline: { type: 'string', description: 'Deterministic one-line summary, true without any LLM' },
        availableCount: { type: 'number' },
        gapCount: { type: 'number' },
      },
    };
  },
};
