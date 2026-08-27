// src/lib/daydream/ponder/run.ts
//
// One ponder cycle: assemble the fact pack, let the model think WIDE, audit
// what comes back, and feed the survivors into the machinery that already
// exists — musings into the thought ledger, lines of enquiry into the leads
// frontier (its first-ever writer), standing rules into the same
// validate → backtest → owner gate the rulesmith uses.
//
// This is the design pivot the 2026-08-27 review agreed: from "rules detect,
// the model only phrases" to "the model ponders, code verifies". What did NOT
// change is who gets to fire a notification: a musing is an ordinary thought
// candidate, so the threshold, kind weights, mutes, cooldowns and delivery
// caps all still stand between anything here and the owner's attention.

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  daydreamDayFeatures,
  daydreamHypotheses,
  daydreamLeads,
  daydreamThoughts,
  daydreamObservations,
  daydreamSignals,
} from '$lib/db/schema';
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDaydreamModel } from '../compose';
import { buildSnapshot } from '../snapshot';
import { persistCandidates, type PersistResult } from '../thought-store';
import { DEFAULT_SUBJECT, errMsg } from '../types';
import { assemblePack, renderPack, type PackInputs } from './pack';
import { buildProfileLines } from './profile';
import {
  MAX_ACTION_RULES,
  MAX_LEADS,
  MAX_MUSINGS,
  MUSING_THEMES,
  validatePonderOutput,
} from './schema';

export interface PonderResult {
  cards: number;
  musings: PersistResult & { proposed: number };
  leadsCreated: number;
  leadsDuplicate: number;
  rulesAdmitted: number;
  rulesRefused: number;
  rejected: string[];
  tokens: { prompt: number; completion: number };
  error: string | null;
}

const EMPTY: PonderResult = {
  cards: 0,
  musings: { created: 0, updated: 0, suppressed: 0, muted: 0, protectedSkipped: 0, createdKeys: [], proposed: 0 },
  leadsCreated: 0,
  leadsDuplicate: 0,
  rulesAdmitted: 0,
  rulesRefused: 0,
  rejected: [],
  tokens: { prompt: 0, completion: 0 },
  error: null,
};

/** Aggregates over the day-feature store — the model gets summaries, never
 *  the raw rows, and every number it may quote appears here verbatim. */
async function featureAggregates(now: Date): Promise<PackInputs['aggregates']> {
  const out: PackInputs['aggregates'] = [];
  try {
    const floor = (days: number) =>
      new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
    const [w] = await db
      .select({
        sleep: sql<number | null>`round(avg(${daydreamDayFeatures.sleepMinutes}))::int`,
        steps: sql<number | null>`round(avg(${daydreamDayFeatures.steps}))::int`,
        out7: sql<number | null>`round(avg(${daydreamDayFeatures.minutesOut}))::int`,
        busy: sql<number | null>`round(avg(${daydreamDayFeatures.calendarBusyMinutes}))::int`,
        spend: sql<number | null>`sum(${daydreamDayFeatures.verifiedSpendMinor})::int`,
      })
      .from(daydreamDayFeatures)
      .where(gte(daydreamDayFeatures.day, floor(7)));
    if (w) {
      if (w.sleep != null) out.push({ key: 'sleep7', text: `Average sleep last 7 days: ${Math.round(w.sleep / 6) / 10}h a night.` });
      if (w.steps != null) out.push({ key: 'steps7', text: `Average steps last 7 days: ${w.steps} a day.` });
      if (w.out7 != null) out.push({ key: 'out7', text: `Average time out of the house last 7 days: ${w.out7} min a day.` });
      if (w.busy != null) out.push({ key: 'busy7', text: `Average timed calendar commitments last 7 days: ${w.busy} min a day.` });
      if (w.spend != null) out.push({ key: 'spend7', text: `Evidenced spend last 7 days: £${(w.spend / 100).toFixed(2)}.` });
    }
  } catch {
    // Aggregates are garnish; the pack stands without them.
  }
  return out;
}

/** How many discovered signals may reach one pack. A limit on the pack, not
 *  a claim that nothing else exists — the sweep still sees all of them. */
const PACK_SIGNAL_LIMIT = 15;

/**
 * The signal registry, summarised for the pack.
 *
 * This is what makes the open registry reach the model at all: the sweep proves
 * relationships, but a musing needs the reading itself in front of it. A card
 * per signal is the whole point — indoor temperature, the weather where John
 * actually was, how long the school run took — none of which needed a line of
 * code here to become sayable.
 *
 * Ranked by how much each MOVED over the week, because a signal that sat still
 * is not worth a card. A thermostat pinned at 21 °C for seven days tells the
 * model nothing it can say anything about, and it would crowd out the one that
 * swung ten degrees. Capped, and the cap is a limit on the pack, not a claim
 * that nothing else exists.
 */
async function signalAggregates(now: Date): Promise<PackInputs['aggregates']> {
  const out: PackInputs['aggregates'] = [];
  try {
    const from = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    const rows = await db
      .select({
        key: daydreamObservations.signalKey,
        label: daydreamSignals.label,
        unit: daydreamSignals.unit,
        source: daydreamSignals.source,
        mean: sql<number | null>`avg(${daydreamObservations.valueMean})`,
        lo: sql<number | null>`min(${daydreamObservations.valueMin})`,
        hi: sql<number | null>`max(${daydreamObservations.valueMax})`,
        days: sql<number>`count(distinct ${daydreamObservations.day})::int`,
      })
      .from(daydreamObservations)
      .innerJoin(daydreamSignals, eq(daydreamSignals.key, daydreamObservations.signalKey))
      .where(and(gte(daydreamObservations.day, from), eq(daydreamSignals.status, 'active')))
      .groupBy(daydreamObservations.signalKey, daydreamSignals.label, daydreamSignals.unit, daydreamSignals.source);

    const scored = rows
      .filter((r) => r.mean != null && r.days >= 2 && r.hi != null && r.lo != null)
      .map((r) => ({
        ...r,
        // Relative spread, so a temperature in °C and a step count are ranked
        // on the same scale rather than by whichever happens to be bigger.
        spread: Math.abs(r.mean as number) > 1e-9 ? ((r.hi as number) - (r.lo as number)) / Math.abs(r.mean as number) : 0,
      }))
      .filter((r) => r.spread > 0)
      .sort((a, b) => b.spread - a.spread)
      .slice(0, PACK_SIGNAL_LIMIT);

    const round = (n: number) => (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
    for (const r of scored) {
      const unit = r.unit ? ` ${r.unit}` : '';
      out.push({
        key: `signal:${r.key}`,
        text:
          `${r.label} over the last ${r.days} day${r.days === 1 ? '' : 's'}: ` +
          `mean ${round(r.mean as number)}${unit}, ` +
          `range ${round(r.lo as number)}–${round(r.hi as number)}${unit}.`,
      });
    }
  } catch {
    // Garnish, like the feature aggregates. The pack stands without them.
  }
  return out;
}

async function recentVerdicts(): Promise<PackInputs['verdicts']> {
  try {
    return await db
      .select({
        id: daydreamHypotheses.id,
        question: daydreamHypotheses.question,
        verdict: sql<string>`coalesce(${daydreamHypotheses.verdict}, 'untested')`,
        summary: daydreamHypotheses.summary,
      })
      .from(daydreamHypotheses)
      .orderBy(desc(daydreamHypotheses.proposedAt))
      .limit(10);
  } catch {
    return [];
  }
}

/** The 7-day diary. Separate from the snapshot's today-view; one CalDAV call. */
async function weekAhead(): Promise<PackInputs['weekAhead']> {
  try {
    const { executeTool } = await import('$lib/workflows/site-tools/registry');
    const res = await executeTool('apple_calendar_list', {
      dateRangeStart: '+1d',
      dateRangeEnd: '+7d',
    });
    const data = res?.data as { events?: unknown[] } | undefined;
    if (!res?.success || !Array.isArray(data?.events)) return [];
    return data.events.slice(0, 20).map((e) => {
      const ev = e as Record<string, unknown>;
      const start = typeof ev.start === 'string' ? ev.start : '';
      return {
        title: typeof ev.title === 'string' ? ev.title : '(untitled)',
        whenText: start.slice(0, 16).replace('T', ' '),
        location: typeof ev.location === 'string' ? ev.location : null,
      };
    });
  } catch {
    return [];
  }
}

function systemPrompt(profileLines: string[]): string {
  return [
    "You are the pondering half of John's second brain. On spare cycles you look across everything it knows — family, diary, money, health, email facts, its own past discoveries — and notice crossings worth surfacing: something happening now that connects to a pattern, something coming up that the past says needs acting on early, a question worth investigating.",
    '',
    'WHO HE IS, FROM HIS OWN TRACES:',
    ...profileLines,
    '',
    'HARD RULES:',
    '1. Reply with ONE JSON object only: {"musings": [], "leads": [], "actionRules": []}. No prose outside it. Empty arrays are a good answer — most cycles find nothing worth saying.',
    `2. A musing = {"slug","theme","title","text","salience","cites",["actions"]}. theme must be one of ${JSON.stringify(MUSING_THEMES)}. text ≤ 280 chars, plain, no greeting, no emoji. salience 0..1 = how much this deserves his attention.`,
    '3. CITE OR DIE: every musing must list the fact-card ids ("F12") it is built from. Any number, date, name or amount you mention must appear in a cited card. An uncited or wrongly-cited musing is deleted by the audit, not fixed.',
    '4. Do not restate a single card back as a musing — the value is the CROSSING between cards (now × pattern, upcoming × history, money × diary).',
    `5. Optional actions on a musing: [{"kind":"remind","label":"...","params":{"inHours":N,"text":"..."}}] — the only kind available. Propose one only when acting later is clearly better than reading now.`,
    `6. A lead = {"leadKey","title","rationale","metrics"} — a line of statistical enquiry worth pursuing over weeks, metrics chosen from the feature store only. At most ${MAX_LEADS}.`,
    `7. An actionRule is a STANDING behaviour (fires on its own once approved): the full rule-spec shape with an added "action". Propose at most ${MAX_ACTION_RULES}, and only when a pattern clearly repeats.`,
    `8. At most ${MAX_MUSINGS} musings. Fewer, sharper.`,
  ].join('\n');
}

export async function runPonder(
  opts: { now?: Date; verify?: boolean; subject?: string } = {},
): Promise<PonderResult> {
  const now = opts.now ?? new Date();
  const subject = opts.subject ?? DEFAULT_SUBJECT;
  const result: PonderResult = { ...EMPTY, musings: { ...EMPTY.musings, createdKeys: [] }, rejected: [], tokens: { prompt: 0, completion: 0 } };

  try {
    const snapshot = await buildSnapshot({ now, subject });
    const [verdicts, aggregates, signals, week, profileLines] = await Promise.all([
      recentVerdicts(),
      featureAggregates(now),
      signalAggregates(now),
      weekAhead(),
      buildProfileLines(now),
    ]);
    const pack = assemblePack({
      snapshot,
      verdicts,
      // Hand-written aggregates first, then whatever the registry discovered —
      // the second list is the one that grows without anyone editing this file.
      aggregates: [...aggregates, ...signals],
      weekAhead: week,
      feedbackLines: [],
      profileLines,
    });
    result.cards = pack.cards.length;
    if (pack.cards.length < 8) {
      result.error = `pack too thin to ponder (${pack.cards.length} cards)`;
      return result;
    }

    const model = await resolveDaydreamModel();
    const { client, model: modelId } = await getLLMClient(model);
    const res = await client.chat.completions.create({
      model: modelId,
      temperature: 0.7,
      max_tokens: 1800,
      messages: [
        { role: 'system', content: systemPrompt(profileLines) },
        { role: 'user', content: renderPack(pack) },
      ],
    });
    result.tokens.prompt = res.usage?.prompt_tokens ?? 0;
    result.tokens.completion = res.usage?.completion_tokens ?? 0;

    const raw = (res.choices[0]?.message?.content ?? '')
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      result.error = 'model did not return JSON';
      return result;
    }

    const audit = validatePonderOutput(parsed, pack);
    result.rejected = audit.rejected;

    // ── Musings → the thought ledger ──
    if (audit.musings.length) {
      const persisted = await persistCandidates(
        audit.musings.map((m) => m.candidate),
        { runId: `ponder-${now.getTime()}`, now },
      );
      result.musings = { ...persisted, proposed: audit.musings.length };

      // The model's own sentence becomes the narrative — it has passed the
      // citation audit, which is a stronger check than the phrasing pass
      // (every claim resolves to a card; compose's verify asks a model to
      // guess). `verified: true` records that audit. Protected statuses are
      // excluded so a musing the owner dismissed cannot resurrect its prose.
      for (const m of audit.musings) {
        await db
          .update(daydreamThoughts)
          .set({ narrative: m.narrative, verified: true, updatedAt: now })
          .where(
            sql`${daydreamThoughts.dedupeKey} = ${m.candidate.dedupeKey}
                and ${daydreamThoughts.status} in ('new', 'suppressed')`,
          );
      }
    } else {
      result.musings.proposed = 0;
    }

    // ── Lines of enquiry → the frontier (its first writer) ──
    for (const lead of audit.leads) {
      const inserted = await db
        .insert(daydreamLeads)
        .values({
          subject,
          leadKey: lead.leadKey,
          title: lead.title,
          rationale: lead.rationale,
          metrics: lead.metrics,
          status: 'open',
        })
        .onConflictDoNothing()
        .returning({ id: daydreamLeads.id });
      if (inserted.length) result.leadsCreated++;
      else result.leadsDuplicate++;
    }

    // ── Standing rules → the same gate the rulesmith uses ──
    for (const rawRule of audit.actionRules) {
      const { admitProposal } = await import('../rules/store');
      const admitted = await admitProposal(rawRule, { proposalKind: 'new' });
      if (admitted.admitted) result.rulesAdmitted++;
      else {
        result.rulesRefused++;
        result.rejected.push(`rule refused: ${admitted.reason ?? 'unknown'}`);
      }
    }

    return result;
  } catch (err) {
    result.error = errMsg(err);
    return result;
  }
}
