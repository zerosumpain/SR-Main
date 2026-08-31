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
import { getLLMClient } from '$lib/llm/client';
import { resolveDaydreamModel } from '../compose';
import { buildSnapshot } from '../snapshot';
import { persistCandidates, type PersistResult } from '../thought-store';
import { DEFAULT_SUBJECT, errMsg } from '../types';
import { assemblePack, renderPack, type PackInputs } from './pack';
import { runLookups, MAX_LOOKUPS_PER_CYCLE } from './lookups';
import { buildProfileLines } from './profile';
import { SWEEP_METRICS, ENTANGLED_PAIRS } from '../stats/sweep';
import { MIN_PAIRS } from '../stats/tests';
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
  /** Metric names the model got nearly right, and what they became. On the
   *  pulse so an alias is visible rather than silently accepted. */
  coerced: string[];
  /** What the lookup stage did. On the pulse so a probe that never pays for
   *  itself is visible rather than quietly costing a round trip a cycle. */
  lookups: { asked: number; cards: number; failed: number };
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
  coerced: [],
  lookups: { asked: 0, cards: 0, failed: 0 },
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

/**
 * What John has said about previous suggestions, verbatim.
 *
 * Carded explicitly rather than left to the snapshot's 200-memory sweep, which
 * has no ordering guarantee: a correction typed yesterday about a suggestion
 * the engine is about to make again is the most valuable card in the pack, and
 * it should not be competing for a slot with a two-year-old note about coffee.
 *
 * Verbatim, and cited like everything else. A note can therefore correct a
 * musing without becoming a second surface on which to invent one.
 */
async function noteCards(): Promise<PackInputs['aggregates']> {
  try {
    const { recentNotes } = await import('../notes');
    const rows = await recentNotes();
    return rows
      .filter((r) => r.note)
      .map((r) => ({
        key: `note:${r.id}`,
        text: `You said about "${r.title}": ${r.note}`,
      }));
  } catch {
    return [];
  }
}

/**
 * What the owner has said specific diary entries MEAN.
 *
 * The whole point of a note that does not hide: "PE days are a reminder to
 * take PE kit into school, not an actual time commitment" is a fact the model
 * should read alongside the diary, and hiding the event would have hidden the
 * kit reminder along with the false commitment.
 */
async function diaryNoteCards(): Promise<PackInputs['aggregates']> {
  try {
    const { diaryNotes } = await import('../calendar/store');
    const rows = await diaryNotes();
    return rows.map((r) => ({
      key: `diary-note:${r.id}`,
      text: `About "${r.title ?? 'a diary entry'}" in the calendar, John says: ${r.reason}`,
    }));
  } catch {
    return [];
  }
}

/**
 * What the REVIEWER settled, so the same misreading is not proposed again.
 *
 * The half that closes the loop. Ruling on a claim already writes a memory
 * (see ../rulings.ts), and the snapshot does sweep 200 memories — but with no
 * ordering guarantee, which is exactly why `noteCards` exists rather than
 * trusting that sweep. A refutation of the claim this cycle is about to make
 * again is the single most valuable card in the pack, and it must not be
 * competing for a slot with a two-year-old note about coffee.
 *
 * The owner's example is the specification: having ruled that the two Canva
 * rows are one payment, it should stop saying there were two charges.
 */
async function rulingCardsFor(): Promise<PackInputs['aggregates']> {
  try {
    const { rulingCards } = await import('../rulings');
    const rows = await rulingCards();
    return rows
      .filter((r) => r.verdict)
      .map((r) => ({
        key: `ruling:${r.id}`,
        text:
          r.verdict === 'refuted'
            ? `A reviewer checked "${r.title}" against the sources and it did NOT hold${r.reasoning ? `: ${r.reasoning}` : ''} Do not propose this again.`
            : `A reviewer checked "${r.title}" against the sources and found it ${r.verdict}${r.reasoning ? `: ${r.reasoning}` : ''}`,
      }));
  } catch {
    // Garnish. The pack stands without it, and a ruling table that cannot be
    // read must not cost the cycle.
    return [];
  }
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
    // Through the shared reader, so an excluded event never reaches the pack.
    // This is the surface that matters most for the rolling-reminder case: a
    // standing reminder in the week ahead is exactly what the model would
    // otherwise build "your week is busy" out of.
    const { readCalendar } = await import('../calendar/read');
    const { loadExclusionSet } = await import('../calendar/store');
    const read = await readCalendar(
      { dateRangeStart: '+1d', dateRangeEnd: '+7d' },
      await loadExclusionSet(),
    );
    if (!read.available) return [];
    return read.events.slice(0, 20).map((e) => ({
      title: e.title,
      whenText: e.start.slice(0, 16).replace('T', ' '),
      location: e.location,
    }));
  } catch {
    return [];
  }
}


/**
 * What the model needs before it can propose a line of enquiry worth running.
 *
 * Two things it has never been told, both of which show up in the outcome:
 *
 *  • **Which metrics actually have data.** A lead pairing two series that do
 *    not overlap is dead the moment it is tested — that is what `underpowered`
 *    means, and production carries 48 of them. The day counts turn the metric
 *    list from a vocabulary into a menu.
 *  • **What is already open.** Nothing showed it the frontier, so every cycle
 *    proposed blind. `onConflictDoNothing` catches an identical `leadKey` and
 *    nothing catches the same question asked under a new one.
 */
async function leadContext(subject: string): Promise<{ open: string[]; menu: string[] }> {
  const out: { open: string[]; menu: string[] } = { open: [], menu: [] };
  try {
    const rows = await db
      .select({ leadKey: daydreamLeads.leadKey, title: daydreamLeads.title })
      .from(daydreamLeads)
      .where(and(eq(daydreamLeads.subject, subject), eq(daydreamLeads.status, 'open')))
      .limit(20);
    out.open = rows.map((r) => `${r.leadKey} — ${r.title}`);
  } catch (err) {
    console.warn(`[daydream] could not read the frontier: ${errMsg(err)}`);
  }

  try {
    // One row, one count per metric. Cheaper than 22 queries and the numbers
    // must come from the same scan or they describe different days.
    const counts = SWEEP_METRICS.map(
      (m) => sql`count(${daydreamDayFeatures[m]})::int as ${sql.raw(`"${m}"`)}`,
    );
    const res = await db.execute(
      sql`select ${sql.join(counts, sql`, `)} from ${daydreamDayFeatures} where ${daydreamDayFeatures.subject} = ${subject}`,
    );
    const row = (Array.isArray(res) ? res[0] : (res as { rows?: unknown[] }).rows?.[0]) as
      | Record<string, unknown>
      | undefined;
    if (row) {
      for (const m of SWEEP_METRICS) {
        const days = Number(row[m] ?? 0);
        // The count is a CEILING on any pair that uses this metric, not the
        // overlap itself — two 250-day series can still share no days. Pairwise
        // overlap would be 231 numbers and does not fit in a prompt, but the
        // ceiling is enough to stop the thinnest series being paired at all,
        // and the thin ones here (minutesOut 30, distinctPlaces 35) are exactly
        // the metrics the underpowered hypotheses keep naming.
        out.menu.push(`${m} (${days} days${days < MIN_PAIRS ? ' — TOO FEW, do not use' : ''})`);
      }
    }
  } catch (err) {
    console.warn(`[daydream] could not count metric coverage: ${errMsg(err)}`);
  }
  return out;
}

function systemPrompt(profileLines: string[], ctx: { open: string[]; menu: string[] }): string {
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
    // The metric vocabulary, spelled out.
    //
    // This line used to read "metrics chosen from the feature store only" and
    // never said what those were. Every lead ever proposed on production was
    // rejected for `unknown metrics`, and the names offered — "Time out",
    // "Verified spend", "Average steps last 7 days", "Readiness" — are the
    // PACK'S OWN PROSE LABELS: told to pick from a vocabulary it could not see,
    // the model named the series off the cards in front of it. Fourteen leads,
    // none created, and nothing ever read the rejection back to it.
    //
    // Position matters as much as presence here, the same way `serves` had to
    // move ahead of the JSON shape before it was ever populated: the keys sit
    // WITH the rule that requires them, not in a footnote.
    `6. A lead = {"leadKey","title","rationale","metrics"} — a line of statistical enquiry worth pursuing over weeks. At most ${MAX_LEADS}.`,
    `   "metrics" MUST be 2 to 6 of these EXACT keys, copied character for character. Nothing else is a metric, and a label you read off a card above is not one.`,
    `   The number beside each is how many days it has recorded — the MOST any pair using it could overlap. A pair needs ${MIN_PAIRS} shared days to be testable at all, so prefer metrics with plenty and never pair two thin ones.`,
    // The menu carries each metric's day count, so a pair that cannot be
    // tested is visibly not worth proposing. Falls back to the bare vocabulary
    // if the count query failed — a list without numbers still beats no list.
    `   ${ctx.menu.length ? ctx.menu.join(', ') : SWEEP_METRICS.join(', ')}`,
    // Tautologies, named. The sweep skips these pairs at test time, so a lead
    // built on one spends a metric slot on a question that can never return an
    // answer — which the first real lead did twice out of six pairs.
    `   These pairs are true by definition and are SKIPPED when tested, so a lead built on one buys nothing: ${ENTANGLED_PAIRS.map(([a, b]) => `${a}+${b}`).join(', ')}.`,
    ...(ctx.open.length
      ? [
          `   ALREADY OPEN — do not propose these again, in any wording:`,
          ...ctx.open.map((l) => `     - ${l}`),
        ]
      : []),
    `   Example: {"leadKey":"sleep-and-time-out","title":"Does time out of the house drive sleep?","rationale":"Sleep has swung 40 minutes across the week while time out of the house doubled on three of those days.","metrics":["sleepMinutes","minutesOut"]}`,
    `7. An actionRule is a STANDING behaviour (fires on its own once approved): the full rule-spec shape with an added "action". Propose at most ${MAX_ACTION_RULES}, and only when a pattern clearly repeats.`,
    `8. At most ${MAX_MUSINGS} musings. Fewer, sharper.`,
  ].join('\n');
}

export async function runPonder(
  opts: { now?: Date; verify?: boolean; subject?: string; lookupBudget?: number } = {},
): Promise<PonderResult> {
  const now = opts.now ?? new Date();
  const subject = opts.subject ?? DEFAULT_SUBJECT;
  const result: PonderResult = { ...EMPTY, musings: { ...EMPTY.musings, createdKeys: [] }, rejected: [], coerced: [], lookups: { asked: 0, cards: 0, failed: 0 }, tokens: { prompt: 0, completion: 0 } };

  try {
    const snapshot = await buildSnapshot({ now, subject });
    const [verdicts, aggregates, signals, week, profileLines, notes, diaryNotes, rulings] = await Promise.all([
      recentVerdicts(),
      featureAggregates(now),
      signalAggregates(now),
      weekAhead(),
      buildProfileLines(now),
      noteCards(),
      diaryNoteCards(),
      rulingCardsFor(),
    ]);
    const leadCtx = await leadContext(subject);
    // The lookup stage. Code names a gap in what it has just assembled, calls a
    // read-only first-party tool and cards the answer — see lookups.ts for why
    // the model is not the one choosing. Soft: a failure here costs cards, never
    // the cycle.
    const lookups = await runLookups(
      { snapshot, weekAhead: week },
      { budget: opts.lookupBudget ?? MAX_LOOKUPS_PER_CYCLE },
    );
    result.lookups = { asked: lookups.asked.length, cards: lookups.cards.length, failed: lookups.failed };

    const pack = assemblePack({
      snapshot,
      verdicts,
      lookups: lookups.cards,
      // Hand-written aggregates first, then whatever the registry discovered —
      // the second list is the one that grows without anyone editing this file.
      // Then anything John has said in his own words, and last what the
      // reviewer has already SETTLED. Those two go nearest the instruction
      // because they are the two that override: a correction he typed, and a
      // claim that has been checked against the sources and found wanting.
      aggregates: [...aggregates, ...signals, ...notes, ...diaryNotes, ...rulings],
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
        { role: 'system', content: systemPrompt(profileLines, leadCtx) },
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
    result.coerced = audit.coerced;

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
