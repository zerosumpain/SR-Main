// src/lib/daydream/appetite/pack.ts
//
// The evidence pack the appetite stage thinks over: what was asked, what the
// site can already reach, and where it came up short.
//
// ── The contract ────────────────────────────────────────────────────────────
//
// Every line is assembled by code from a real row and carries a `key`. The
// model may only cite those keys, and `validateProposals` drops anything
// citing something that was not here. That is the same arrangement `ponder`
// runs under, and it exists for the same reason: asked what the site should
// build, a model with no pack will confidently name four SaaS products.
//
// ── Why the inventory is half of it ─────────────────────────────────────────
//
// The expensive failure is not a bad idea, it is a duplicate. Self-improvement
// spent a fortnight building `home_temperature_evidence_history` and
// `family_location_history_timeline` — a shadow copy of capabilities daydream
// already had and could not see. So the pack states plainly what exists:
// signal sources and how many series each has, catalogued APIs, toolsets,
// live watches, news feeds, scheduled workflows. An idea for something already
// on this list is a wasted night.

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  daydreamSignals,
  orchestratorChats,
  workflows,
  workflowSchedules,
} from '$lib/db/schema';
import { getCollectionBySlug, getRecordByKey, queryRecords } from '$lib/datastore';
import { NEWS_SOURCES } from '$lib/constants/news-sources';
import { errMsg } from '../types';
import { openFaults } from '../faults';
import { collectStarvation } from '../starvation';
import { listCapabilities } from './store';
import type { PackFact } from './spec';
import { investigationGapFacts } from '../hypotheses/gaps';

/**
 * Datastore collections read by literal slug rather than by importing
 * `$lib/selfimprove/types`.
 *
 * `$lib/jkai` already imports `$lib/selfimprove`, so an import the other way
 * would put a new `selfimprove <-> daydream` cycle in front of
 * `check-module-boundaries`, and the standing rule is that the wire runs one
 * way: self-improve reads daydream, never the reverse. Two string literals are
 * the cheaper price.
 */
const QUESTION_INSIGHTS = 'question_insights';
const API_CATALOG = 'api_catalog';
const MONITORS = 'monitors';

const SYSTEM_ACTOR = 'system';

export interface AppetitePack {
  facts: PackFact[];
  /** Fast membership for the citation audit. */
  keys: Set<string>;
  /** Counts for the pulse — a pack that shrank is worth seeing. */
  sizes: Record<string, number>;
}

function push(facts: PackFact[], key: string, text: string): void {
  const t = text.trim();
  if (t) facts.push({ key, text: t.slice(0, 400) });
}

// ── What was asked ──────────────────────────────────────────────────────────

/**
 * The owner's questions, as TYPES rather than a transcript.
 *
 * The brief asks the engine to think about "the types of questions asked".
 * `question_insights` already holds exactly that — intents with counts and a
 * `servedWell` flag, computed by the learn phase — so this reads it rather
 * than re-deriving a taxonomy nightly. The raw questions still come in
 * underneath, capped and short, because an intent label loses the specifics a
 * source proposal needs ("trains to Norwich" reads as "travel").
 */
async function questionFacts(facts: PackFact[]): Promise<number> {
  let n = 0;
  try {
    if (await getCollectionBySlug(QUESTION_INSIGHTS)) {
      const rec = await getRecordByKey(QUESTION_INSIGHTS, 'latest', SYSTEM_ACTOR);
      const data = rec?.data as
        | { intents?: Array<{ intent?: string; count?: number; servedWell?: boolean; missingCapability?: string }>; topUnmet?: string[] }
        | undefined;
      for (const [i, intent] of (data?.intents ?? []).slice(0, 10).entries()) {
        const label = String(intent?.intent ?? '').trim();
        if (!label) continue;
        push(
          facts,
          `intent:${i}`,
          `Asked about "${label}" ${Number(intent?.count ?? 0)} time(s) recently; ${intent?.servedWell ? 'answered well' : 'NOT answered well'}` +
            (intent?.missingCapability ? ` — missing: ${intent.missingCapability}` : '') +
            '.',
        );
        n++;
      }
      for (const [i, unmet] of (data?.topUnmet ?? []).slice(0, 5).entries()) {
        push(facts, `unmet:${i}`, `Unmet need from the owner's questions: ${unmet}`);
        n++;
      }
    }
  } catch (err) {
    console.warn(`[daydream] appetite: question insights unread — ${errMsg(err)}`);
  }

  try {
    const since = new Date(Date.now() - 14 * 86_400_000);
    const rows = await db
      .select({ content: orchestratorChats.content })
      .from(orchestratorChats)
      .where(and(eq(orchestratorChats.role, 'user'), gte(orchestratorChats.createdAt, since)))
      .orderBy(desc(orchestratorChats.createdAt))
      .limit(120);
    const questions = rows
      .map((r) => (r.content ?? '').trim().replace(/\s+/g, ' '))
      // Long bodies are pasted documents, not questions; short ones are
      // "crack on". Neither says anything about what the site should be able
      // to do.
      .filter((c) => c.length >= 25 && c.length <= 240)
      .slice(0, 40);
    for (const [i, q] of questions.entries()) {
      push(facts, `q:${i}`, `Asked: ${q}`);
      n++;
    }
  } catch (err) {
    console.warn(`[daydream] appetite: questions unread — ${errMsg(err)}`);
  }
  return n;
}

// ── What already exists ─────────────────────────────────────────────────────

async function inventoryFacts(facts: PackFact[]): Promise<number> {
  let n = 0;

  try {
    const rows = await db
      .select({
        source: daydreamSignals.source,
        signals: sql<number>`count(*)::int`,
        observing: sql<number>`count(*) filter (where ${daydreamSignals.observedDays} > 0)::int`,
      })
      .from(daydreamSignals)
      .groupBy(daydreamSignals.source);
    for (const r of rows.sort((a, b) => b.signals - a.signals)) {
      push(
        facts,
        `source:${r.source}`,
        `Signal source "${r.source}" already exists: ${r.signals} series, ${r.observing} of them observing.`,
      );
      n++;
    }
  } catch (err) {
    console.warn(`[daydream] appetite: signal sources unread — ${errMsg(err)}`);
  }

  try {
    const { getToolsetManifest } = await import('$lib/workflows/site-tools/registry');
    const sets = getToolsetManifest()
      .map((t) => `${t.toolset} (${t.tools.length})`)
      .sort();
    if (sets.length) {
      push(facts, 'toolsets', `Toolsets already available to jkai: ${sets.join(', ')}.`);
      n++;
    }
  } catch (err) {
    console.warn(`[daydream] appetite: toolsets unread — ${errMsg(err)}`);
  }

  try {
    if (await getCollectionBySlug(API_CATALOG)) {
      const { records } = await queryRecords(API_CATALOG, { limit: 200 }, SYSTEM_ACTOR);
      const names = records
        .map((r) => r.data as Record<string, unknown>)
        .filter((d) => (d.status ?? 'seeded') !== 'broken')
        .map((d) => String(d.name ?? ''))
        .filter(Boolean)
        .sort();
      if (names.length) {
        push(facts, 'apis', `APIs already in the catalogue (${names.length}): ${names.slice(0, 40).join(', ')}.`);
        n++;
      }
    }
  } catch (err) {
    console.warn(`[daydream] appetite: API catalogue unread — ${errMsg(err)}`);
  }

  try {
    // The markers, NOT `listMonitors()` — that helper lazily re-enables
    // snoozed schedules and walks run history on every read, which is not
    // something assembling a prompt should be doing.
    if (await getCollectionBySlug(MONITORS)) {
      const { records } = await queryRecords(MONITORS, { limit: 60 }, SYSTEM_ACTOR);
      const descs = records
        .map((r) => String((r.data as { description?: unknown })?.description ?? '').trim())
        .filter(Boolean);
      push(
        facts,
        'watches',
        descs.length
          ? `Watches already running (${descs.length}): ${descs.slice(0, 12).join(' · ')}.`
          : 'No watches exist yet — nothing is being monitored on a schedule.',
      );
      n++;
    }
  } catch (err) {
    console.warn(`[daydream] appetite: watches unread — ${errMsg(err)}`);
  }

  push(
    facts,
    'news',
    `News sources wired into the site: ${NEWS_SOURCES.join(', ')}. Adding another is a code change, not a setting.`,
  );
  n++;

  try {
    const rows = await db
      .select({ name: workflows.name, enabled: workflowSchedules.enabled, config: workflowSchedules.config })
      .from(workflowSchedules)
      .innerJoin(workflows, eq(workflows.id, workflowSchedules.workflowId))
      .limit(40);
    // Both keys: the canvas writes `expression`, the site tools wrote `cron`,
    // and the scheduler itself tolerates either (see `workflows/scheduler.ts`).
    const cronOf = (cfg: unknown): string => {
      const c = (cfg ?? {}) as Record<string, unknown>;
      return (typeof c.expression === 'string' && c.expression) || (typeof c.cron === 'string' && c.cron) || 'no cron';
    };
    const live = rows.filter((r) => r.enabled).map((r) => `${r.name} (${cronOf(r.config)})`);
    push(
      facts,
      'schedules',
      live.length
        ? `Scheduled workflows already running (${live.length}): ${live.slice(0, 15).join(' · ')}.`
        : 'No scheduled workflows are enabled.',
    );
    n++;
  } catch (err) {
    console.warn(`[daydream] appetite: schedules unread — ${errMsg(err)}`);
  }

  return n;
}

// ── Where it came up short ──────────────────────────────────────────────────

async function gapFacts(facts: PackFact[]): Promise<number> {
  let n = 0;
  try {
    for (const f of (await openFaults({ limit: 12 })).slice(0, 12)) {
      push(
        facts,
        `fault:${f.kind}:${f.identifier}`,
        `Daydreaming failed ${f.count}× at ${f.site}: ${f.detail ?? f.kind} (it wants a ${f.wants.replace(/_/g, ' ')}).`,
      );
      n++;
    }
  } catch (err) {
    console.warn(`[daydream] appetite: faults unread — ${errMsg(err)}`);
  }

  try {
    for (const [i, s] of (await collectStarvation()).slice(0, 6).entries()) {
      push(facts, `starved:${i}`, `${s.title} — ${s.evidence}`);
      n++;
    }
  } catch (err) {
    console.warn(`[daydream] appetite: starvation unread — ${errMsg(err)}`);
  }
  return n;
}

// ── What has already been proposed ──────────────────────────────────────────

/**
 * The ledger, back into the prompt.
 *
 * Without this the stage re-proposes the same four ideas nightly, which is the
 * exact failure `improvement_backlog` was written to end ("news digest" and
 * "current time" re-invented across ten consecutive nights). Declined rows go
 * in too, and say so — a `no` the model cannot see is a `no` it will ask again.
 */
async function ledgerFacts(facts: PackFact[]): Promise<number> {
  let n = 0;
  try {
    const rows = await listCapabilities({ limit: 40 });
    for (const c of rows) {
      push(
        facts,
        `lead:${c.slug}`,
        `Already on the ledger (${c.status}${c.status === 'declined' ? ' — do not propose again' : ''}): ${c.title}.`,
      );
      n++;
    }
  } catch (err) {
    console.warn(`[daydream] appetite: ledger unread — ${errMsg(err)}`);
  }
  return n;
}

/** Assemble the pack. Every section is independently soft — a section that
 *  cannot be read leaves its lines out rather than sinking the run. */
export async function assembleAppetitePack(): Promise<AppetitePack> {
  const facts: PackFact[] = [];
  const sizes: Record<string, number> = {};
  sizes.questions = await questionFacts(facts);
  sizes.inventory = await inventoryFacts(facts);
  sizes.gaps = await gapFacts(facts);
  // Unlike short inventory lines, these retain the evidence need and acceptance check.
  const investigationFacts = await investigationGapFacts();
  facts.push(...investigationFacts);
  sizes.gaps += investigationFacts.length;
  sizes.investigations = investigationFacts.length;
  sizes.ledger = await ledgerFacts(facts);
  return { facts, keys: new Set(facts.map((f) => f.key)), sizes };
}

/** The pack as the model sees it: one `key — text` line each, grouped. */
export function renderAppetitePack(pack: AppetitePack): string {
  const group = (prefix: string) => pack.facts.filter((f) => f.key.startsWith(prefix));
  const block = (title: string, items: PackFact[]) =>
    items.length ? [`## ${title}`, ...items.map((f) => `[${f.key}] ${f.text}`), ''].join('\n') : '';
  const asked = pack.facts.filter((f) => /^(intent|unmet|q):/.test(f.key));
  const gaps = pack.facts.filter((f) => /^(fault|starved|investigation):/.test(f.key));
  const ledger = group('lead:');
  const askedSet = new Set([...asked, ...gaps, ...ledger].map((f) => f.key));
  const inventory = pack.facts.filter((f) => !askedSet.has(f.key));
  return [
    block('What the owner asked about', asked),
    block('What the site can already reach — do not propose any of this again', inventory),
    block('Where the engine came up short', gaps),
    block('Already proposed', ledger),
  ]
    .filter(Boolean)
    .join('\n');
}
