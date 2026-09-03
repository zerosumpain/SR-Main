// src/lib/daydream/signals/tools.ts
//
// Tools the self-improvement loop wrote, as signals.
//
// ── The gap this closes ─────────────────────────────────────────────────────
//
// The registry's own doc comment names this caller: "The contract for a future
// source — a connector, or a tool the self-improvement loop writes for itself —
// is exactly these two calls." It was written on 2026-08-27 and had no
// self-improvement caller at all.
//
// Meanwhile the engine shipped **33 tools in the fortnight to 2026-08-30 and
// not one of them was ever called.** It mines John's questions for unmet needs,
// authors a tool, auto-enables it, and then waits for a chat turn to ask the
// same question a second time — which is not a thing that happens. The tools it
// built are `vo2max_training_baseline`, `sleep_data_provenance`,
// `truelayer_account_balances`, `recurring_outgoings_evidence`,
// `family_movement_snapshot`: daily measurements about the owner's own life,
// sitting inert.
//
// A signal is exactly what those are. Registered, they are read once a day,
// join the correlation sweep once they have `MIN_PAIRS` days, and reach the
// ponder pack — so the engine's output finally lands somewhere with an
// appetite, and what it learns there is what tells it what to build next.
//
// ── Why discovery, and not a flag set at ship time ──────────────────────────
//
// `verify.ts` runs the smoke test but `CaseOutcome` keeps only ok/error/ms, not
// the data — so reading a shipped tool's shape there would mean editing the one
// file that is the entire security boundary between LLM-authored text and the
// environment. Discovering from the live registry instead touches none of it,
// and has the larger advantage: it adopts the **67 tools that already exist**,
// not just the ones shipped from today onward.
//
// ── Why only tools that need no arguments ───────────────────────────────────
//
// A signal is read every day, forever. Calling a tool means supplying its
// arguments, and code cannot invent them — guessing is how a tool ends up
// called with the wrong input daily and quietly recording a series about
// nothing. 22 of the 67 enabled tools declare no required parameters, which is
// the set that can be honestly sampled. The rest are not rejected, merely not
// self-sampling; a tool that wants to be a signal can declare defaults.

import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { customTools, daydreamObservations, daydreamSignals } from '$lib/db/schema';
import { executeTool } from '$lib/workflows/site-tools/registry';
import { errMsg } from '../types';
import { registerSignals, signalKey, type Reading, type SignalSpec } from './registry';

export const SOURCE = 'tool';

/** Tools sampled per run. Each is a real invocation and several reach an
 *  external API, so this is a cost ceiling as much as a time one. */
export const MAX_TOOLS_PER_RUN = 25;

/**
 * ONCE A DAY, not once a tick.
 *
 * `daydream-signals` runs **hourly**, and sampling is a real invocation of every
 * tool — `truelayer_account_balances`, `paypal_subscriptions_list`,
 * `tfl_line_status`, `github_service_status` all reach a third party. Hourly
 * that is 22 × 24 ≈ **528 external calls a day**, against financial APIs among
 * others, for a series whose grain is a day. TrueLayer is the sharp end: its
 * refresh token rotates on every exchange.
 *
 * The observation store folds readings into one row per day anyway, so nothing
 * is gained by asking more often than the series can resolve.
 */
export async function alreadySampledToday(day: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(daydreamObservations)
      .where(
        and(
          eq(daydreamObservations.day, day),
          sql`${daydreamObservations.signalKey} LIKE ${`${SOURCE}:%`}`,
        ),
      );
    return Number(row?.n ?? 0) > 0;
  } catch (err) {
    // Fail CLOSED: if we cannot tell whether today was already sampled, do NOT
    // sample. A missed day costs one point in a series; an unreadable guard
    // that defaults to sampling turns a daily job back into an hourly one.
    console.warn(`[daydream] could not check today's tool sampling: ${errMsg(err)}`);
    return true;
  }
}

/**
 * A tool whose signals were registered and then never produced a reading for
 * this long stops being sampled.
 *
 * Deliberately derived from `observedDays` and `firstSeenAt` rather than a new
 * `consecutive_failures` column. A tool that fails its very first call never
 * gets a signal row at all, so there is nothing to count against it — it is
 * simply retried, which costs one failed call a day out of at most 25 and is
 * named on the pulse. What actually needs muting is the tool that registered a
 * signal and then went dark, and the two columns already say that.
 */
export const BARREN_DAYS_BEFORE_IGNORING = 7;

/** Per-call ceiling. A tool that hangs must not hold the run. */
const CALL_TIMEOUT_MS = 20_000;

/**
 * Field names that are identifiers rather than quantities. Same reasoning as
 * the HA sweep's `IDENTIFIER_ATTRIBUTE`, which was written after discovery
 * registered `last_video_id` at 7.67e18: a number that changes daily and
 * correlates with nothing is exactly what an automatic sweep must not test.
 *
 * The HA pattern anchors on `_`, because Home Assistant attributes are
 * snake_case. A hand-written custom tool returns whatever its author felt like
 * and that is overwhelmingly camelCase — `accountId`, `transactionId` — which
 * the underscore boundary sails straight past. Names are normalised to
 * snake_case first so one rule covers both.
 */
const IDENTIFIER_FIELD =
  /(^|_)(id|ids|uuid|guid|serial|serial_number|mac|token|hash|revision|sequence|timestamp|epoch|ms|millis)$/i;

/** `accountId` → `account_id`, `restingHR` → `resting_hr`. */
function snakeCase(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/** Past this, a number is an identifier or a timestamp, never a measurement.
 *  `date_time_now` returns a unix ms value around 1.7e12 and is the reason this
 *  is not merely theoretical. */
const ABSURD_MAGNITUDE = 1e12;

/** Fields that are counts of the call itself rather than facts about the world. */
const META_FIELD = /^(count|total|length|size|status|code|page|limit|offset|success|ok|elapsed|ms|duration)$/i;

export interface ToolHarvest {
  specs: SignalSpec[];
  readings: Reading[];
  /** Tools called that yielded nothing numeric — reported, never silent. */
  barren: string[];
  /** Tools that errored this run. */
  failed: Array<{ name: string; error: string }>;
  sampled: number;
}

/**
 * Numeric scalars at the top level of a tool's `data`.
 *
 * Top level only, deliberately. A nested walk finds far more numbers and almost
 * all of them are noise — array indices, pagination, per-row ids — and the
 * deeper a key is, the less its name means on a chart three weeks later.
 */
export function numericFields(data: unknown): Array<{ field: string; value: number }> {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return [];
  const out: Array<{ field: string; value: number }> = [];
  for (const [field, raw] of Object.entries(data as Record<string, unknown>)) {
    let value: number | null = null;
    if (typeof raw === 'number' && Number.isFinite(raw)) value = raw;
    // Booleans as 0/1: a daily mean is then a duty cycle, the same convention
    // the HA sweep uses for on/off.
    else if (typeof raw === 'boolean') value = raw ? 1 : 0;
    if (value === null) continue;
    const normalised = snakeCase(field);
    if (IDENTIFIER_FIELD.test(normalised)) continue;
    if (META_FIELD.test(normalised)) continue;
    if (Math.abs(value) >= ABSURD_MAGNITUDE) continue;
    out.push({ field, value });
  }
  return out;
}

/** Tools that can be honestly sampled: enabled, and needing no arguments. */
export async function sampleableTools(): Promise<Array<{ name: string; description: string }>> {
  const rows = await db
    .select({
      name: customTools.name,
      description: customTools.description,
      parameters: customTools.parameters,
    })
    .from(customTools)
    .where(eq(customTools.enabled, true));

  return rows
    .filter((r) => {
      const req = (r.parameters as { required?: unknown } | null)?.required;
      return !Array.isArray(req) || req.length === 0;
    })
    .map((r) => ({ name: r.name, description: r.description ?? r.name }));
}

async function callWithTimeout(name: string): Promise<{ success: boolean; data?: unknown; error?: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      executeTool(name, {}),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${CALL_TIMEOUT_MS}ms`)), CALL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Call every sampleable tool once and turn whatever numbers come back into
 * signals.
 *
 * Never throws: this runs inside a heartbeat activity beside other sources, and
 * one broken custom tool must not cost the whole sweep its readings.
 */
export async function harvestToolSignals(
  opts: { limit?: number } = {},
): Promise<ToolHarvest> {
  const out: ToolHarvest = { specs: [], readings: [], barren: [], failed: [], sampled: 0 };
  let tools: Array<{ name: string; description: string }>;
  try {
    tools = await sampleableTools();
  } catch (err) {
    console.error('[daydream] could not list sampleable tools:', errMsg(err));
    return out;
  }

  const ignored = await ignoredToolNames();
  const usable = tools.filter((t) => !ignored.has(t.name)).slice(0, opts.limit ?? MAX_TOOLS_PER_RUN);

  for (const tool of usable) {
    out.sampled++;
    let res: { success: boolean; data?: unknown; error?: string };
    try {
      res = await callWithTimeout(tool.name);
    } catch (err) {
      out.failed.push({ name: tool.name, error: errMsg(err).slice(0, 200) });
      void import('../faults').then(({ raiseFault }) => raiseFault({ kind: 'tool_failed', identifier: tool.name, site: 'signals/tools', detail: errMsg(err).slice(0, 200) }));
      continue;
    }
    if (!res?.success) {
      out.failed.push({ name: tool.name, error: (res?.error ?? 'no result').slice(0, 200) });
      void import('../faults').then(({ raiseFault }) => raiseFault({ kind: 'tool_failed', identifier: tool.name, site: 'signals/tools', detail: (res?.error ?? 'no result').slice(0, 200) }));
      continue;
    }
    const fields = numericFields(res.data);
    if (fields.length === 0) {
      out.barren.push(tool.name);
      void import('../faults').then(({ raiseFault }) => raiseFault({ kind: 'tool_barren', identifier: tool.name, site: 'signals/tools', detail: 'returned no numeric top-level field' }));
      continue;
    }
    for (const { field, value } of fields) {
      const key = signalKey(SOURCE, `${tool.name}#${field}`);
      out.specs.push({
        key,
        source: SOURCE,
        label: `${tool.description.slice(0, 60)} — ${field.replace(/_/g, ' ')}`,
      });
      out.readings.push({ key, value });
    }
  }
  return out;
}

/** Signal keys already muted, so a broken or useless tool is not re-sampled.
 *  `registerSignals` will not resurrect an ignored signal, and this stops us
 *  paying for the call that would have re-offered it. */
async function ignoredToolNames(): Promise<Set<string>> {
  try {
    const rows = await db
      .select({ key: daydreamSignals.key })
      .from(daydreamSignals)
      .where(and(eq(daydreamSignals.source, SOURCE), eq(daydreamSignals.status, 'ignored')));
    // `tool:<name>#<field>` → <name>
    return new Set(rows.map((r) => r.key.slice(SOURCE.length + 1).split('#')[0]));
  } catch {
    return new Set();
  }
}

/**
 * Mute signals that were registered and then never produced a reading.
 *
 * `registerSignals` will not un-ignore a signal, so this is one-way: a tool
 * that comes back to life needs the owner to reactivate it, which is the same
 * rule every other muted signal follows and the reason the update set omits
 * `status` in the first place.
 */
export async function retireBarrenToolSignals(now: Date = new Date()): Promise<{ ignored: number }> {
  const cutoff = new Date(now.getTime() - BARREN_DAYS_BEFORE_IGNORING * 86_400_000);
  try {
    const res = await db
      .update(daydreamSignals)
      .set({ status: 'ignored', updatedAt: now })
      .where(
        and(
          eq(daydreamSignals.source, SOURCE),
          eq(daydreamSignals.status, 'active'),
          eq(daydreamSignals.observedDays, 0),
          sql`${daydreamSignals.firstSeenAt} < ${cutoff}`,
        ),
      )
      .returning({ key: daydreamSignals.key });
    return { ignored: res.length };
  } catch (err) {
    console.warn(`[daydream] could not retire barren tool signals: ${errMsg(err)}`);
    return { ignored: 0 };
  }
}

/** Register whatever the harvest found. Split from the harvest so a caller can
 *  inspect before writing, and so tests need no database. */
export async function registerHarvest(h: ToolHarvest): Promise<{ registered: number }> {
  if (h.specs.length === 0) return { registered: 0 };
  return registerSignals(h.specs);
}
