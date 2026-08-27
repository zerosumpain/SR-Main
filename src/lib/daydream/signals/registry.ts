// src/lib/daydream/signals/registry.ts
//
// The one door into the signal store. Everything that wants daydream to notice
// something comes through `registerSignal` and `recordObservation`, and nothing
// else needs to change for it to be swept, carded and pondered.
//
// That is the whole point of the module. Before it, adding a measurement meant
// a schema column, a `features/build.ts` edit and a new entry in the sweep's
// hand-written metric list — three files and a deploy, which is why in practice
// nobody added any and daydream read five of Home Assistant's 415 entities.
// A source now declares what it can see and stops there.
//
// The contract for a future source — a connector, or a tool the
// self-improvement loop writes for itself — is exactly these two calls. There
// is no registration file to edit and no list to join.

import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamObservations, daydreamSignals } from '$lib/db/schema';

/** A series someone wants daydream to know about. */
export interface SignalSpec {
  /** Namespaced `source:identifier`. Stable — it is the primary key, and a key
   *  that changes shape between releases orphans every observation under it. */
  key: string;
  source: string;
  label: string;
  unit?: string | null;
  valueKind?: 'numeric' | 'boolean';
  deviceClass?: string | null;
}

/** One reading, at a moment. The store does the aggregating. */
export interface Reading {
  key: string;
  subject?: string;
  /** Numbers as themselves; booleans as 0/1, so a daily mean is a duty cycle. */
  value: number;
}

/** Namespacing is mechanical so two sources cannot collide, and so a key can be
 *  read back to its origin without a lookup. */
export function signalKey(source: string, identifier: string): string {
  return `${source}:${identifier}`;
}

/**
 * Register anything not already known; leave everything else exactly as it is.
 *
 * Idempotent by construction — discovery runs hourly and will re-offer the same
 * few hundred signals every time. Re-offering must never resurrect a signal the
 * owner muted, so `status` is deliberately absent from the update set: a source
 * can refresh a label or a unit, and cannot un-ignore itself.
 */
export async function registerSignals(specs: SignalSpec[]): Promise<{ registered: number }> {
  if (specs.length === 0) return { registered: 0 };

  const before = await db
    .select({ key: daydreamSignals.key })
    .from(daydreamSignals)
    .where(inArray(daydreamSignals.key, specs.map((s) => s.key)));
  const known = new Set(before.map((r) => r.key));

  await db
    .insert(daydreamSignals)
    .values(
      specs.map((s) => ({
        key: s.key,
        source: s.source,
        label: s.label,
        unit: s.unit ?? null,
        valueKind: s.valueKind ?? 'numeric',
        deviceClass: s.deviceClass ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: daydreamSignals.key,
      set: {
        label: sql`excluded.label`,
        unit: sql`excluded.unit`,
        deviceClass: sql`excluded.device_class`,
        updatedAt: new Date(),
      },
    });

  return { registered: specs.filter((s) => !known.has(s.key)).length };
}

/**
 * Fold readings into today's row for each signal.
 *
 * A running mean rather than a stored sample list: discovery reads the whole
 * house hourly, so a day is at most twenty-four readings per signal and keeping
 * them all would trade a great deal of storage for a precision nothing here
 * asks for. Min, max and last ride along because "the mean indoor temperature"
 * and "the coldest it got" are different questions and only one of them can be
 * recovered from a mean.
 *
 * The upsert arithmetic runs in SQL rather than read-modify-write, so two
 * concurrent writers cannot lose a reading between them.
 */
export async function recordObservations(day: string, readings: Reading[]): Promise<number> {
  const usable = readings.filter((r) => Number.isFinite(r.value));
  if (usable.length === 0) return 0;

  await db
    .insert(daydreamObservations)
    .values(
      usable.map((r) => ({
        day,
        subject: r.subject ?? 'household',
        signalKey: r.key,
        valueMean: r.value,
        valueMin: r.value,
        valueMax: r.value,
        valueLast: r.value,
        samples: 1,
      })),
    )
    .onConflictDoUpdate({
      target: [daydreamObservations.day, daydreamObservations.subject, daydreamObservations.signalKey],
      set: {
        valueMean: sql`(${daydreamObservations.valueMean} * ${daydreamObservations.samples} + excluded.value_mean) / (${daydreamObservations.samples} + 1)`,
        valueMin: sql`least(${daydreamObservations.valueMin}, excluded.value_min)`,
        valueMax: sql`greatest(${daydreamObservations.valueMax}, excluded.value_max)`,
        valueLast: sql`excluded.value_last`,
        samples: sql`${daydreamObservations.samples} + 1`,
        updatedAt: new Date(),
      },
    });

  return usable.length;
}

/**
 * Overwrite a day outright rather than folding into it.
 *
 * For sources that already produce ONE settled value per day — the feature-store
 * mirror, a weather archive backfill — where a running mean would be wrong: run
 * the mirror twice and a folded value drifts toward itself while `samples`
 * climbs, which then misreports how well observed the day was.
 */
export async function setObservations(day: string, readings: Reading[]): Promise<number> {
  const usable = readings.filter((r) => Number.isFinite(r.value));
  if (usable.length === 0) return 0;

  await db
    .insert(daydreamObservations)
    .values(
      usable.map((r) => ({
        day,
        subject: r.subject ?? 'household',
        signalKey: r.key,
        valueMean: r.value,
        valueMin: r.value,
        valueMax: r.value,
        valueLast: r.value,
        samples: 1,
      })),
    )
    .onConflictDoUpdate({
      target: [daydreamObservations.day, daydreamObservations.subject, daydreamObservations.signalKey],
      set: {
        valueMean: sql`excluded.value_mean`,
        valueMin: sql`excluded.value_min`,
        valueMax: sql`excluded.value_max`,
        valueLast: sql`excluded.value_last`,
        samples: sql`1`,
        updatedAt: new Date(),
      },
    });

  return usable.length;
}

/**
 * Refresh each signal's observed-day count and last-seen.
 *
 * DERIVED from the observations rather than incremented at write time — the
 * same call the rules engine makes about outcomes, and for the same reason: a
 * counter maintained at the write site drifts the first time a backfill, a
 * repair or a second writer touches the table, and nothing ever notices.
 */
export async function refreshSignalStats(): Promise<number> {
  const rows = await db.execute(sql`
    update ${daydreamSignals} s
       set observed_days = c.days,
           last_seen_at  = c.last_day,
           updated_at    = now()
      from (
        select signal_key, count(distinct day) as days, max(day)::timestamptz as last_day
          from ${daydreamObservations}
         group by signal_key
      ) c
     where c.signal_key = s.key
       and (s.observed_days is distinct from c.days or s.last_seen_at is distinct from c.last_day)
  `);
  return (rows as unknown as { rowCount?: number }).rowCount ?? 0;
}

/** Signals with enough observed days to be worth testing. */
export async function listSweepableSignals(minDays: number) {
  return db
    .select()
    .from(daydreamSignals)
    .where(and(eq(daydreamSignals.status, 'active'), gte(daydreamSignals.observedDays, minDays)))
    .orderBy(daydreamSignals.key);
}

/** "Stop pondering this one." Survives re-discovery, which dismissing a finding
 *  would not — the same distinction places draw between `ignored` and the
 *  engine's own judgement. */
export async function ignoreSignal(key: string): Promise<void> {
  await db
    .update(daydreamSignals)
    .set({ status: 'ignored', updatedAt: new Date() })
    .where(eq(daydreamSignals.key, key));
}
