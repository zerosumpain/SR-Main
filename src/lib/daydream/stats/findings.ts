// src/lib/daydream/stats/findings.ts
//
// The sweep's survivors, kept. Written by `daydream-sweep`, read by ponder.

import { and, desc, gte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamSweepFindings } from '$lib/db/schema';
import { LOCAL_TZ } from '../types';
import type { SweepResult } from './sweep';

function localDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LOCAL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Upsert every finding of one sweep for one subject, keyed on the day. */
export async function saveFindings(subject: string, res: SweepResult, now = new Date()): Promise<number> {
  if (!res.findings.length) return 0;
  const day = localDay(now);
  const values = res.findings.map((f) => ({
    subject,
    day,
    a: f.a,
    b: f.b,
    aLabel: f.aLabel ?? null,
    bLabel: f.bLabel ?? null,
    lagDays: f.lagDays,
    r: f.r,
    p: f.p,
    qValue: f.qValue,
    n: f.n,
    windowDays: res.windowDays,
  }));
  await db
    .insert(daydreamSweepFindings)
    .values(values)
    .onConflictDoUpdate({
      target: [daydreamSweepFindings.subject, daydreamSweepFindings.day, daydreamSweepFindings.a, daydreamSweepFindings.b, daydreamSweepFindings.lagDays],
      set: {
        r: sql`excluded.r`,
        p: sql`excluded.p`,
        qValue: sql`excluded.q_value`,
        n: sql`excluded.n`,
        aLabel: sql`excluded.a_label`,
        bLabel: sql`excluded.b_label`,
      },
    });
  return values.length;
}

export interface RecentFinding {
  subject: string;
  day: string;
  a: string;
  b: string;
  aLabel: string | null;
  bLabel: string | null;
  lagDays: number;
  r: number;
  qValue: number;
  n: number;
}

/** The strongest findings of the last `days` days, one row per pair (newest day wins). */
export async function recentFindings(opts: { days?: number; limit?: number; subject?: string } = {}): Promise<RecentFinding[]> {
  const since = localDay(new Date(Date.now() - (opts.days ?? 7) * 86_400_000));
  const rows = await db
    .select({
      subject: daydreamSweepFindings.subject,
      day: daydreamSweepFindings.day,
      a: daydreamSweepFindings.a,
      b: daydreamSweepFindings.b,
      aLabel: daydreamSweepFindings.aLabel,
      bLabel: daydreamSweepFindings.bLabel,
      lagDays: daydreamSweepFindings.lagDays,
      r: daydreamSweepFindings.r,
      qValue: daydreamSweepFindings.qValue,
      n: daydreamSweepFindings.n,
    })
    .from(daydreamSweepFindings)
    .where(and(gte(daydreamSweepFindings.day, since), ...(opts.subject ? [sql`${daydreamSweepFindings.subject} = ${opts.subject}`] : [])))
    .orderBy(desc(daydreamSweepFindings.day), desc(sql`abs(${daydreamSweepFindings.r})`))
    .limit(200);
  const seen = new Set<string>();
  const out: RecentFinding[] = [];
  for (const r of rows) {
    const key = `${r.subject}|${r.a}|${r.b}|${r.lagDays}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, day: String(r.day) });
    if (out.length >= (opts.limit ?? 8)) break;
  }
  return out.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
}
