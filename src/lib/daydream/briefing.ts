// src/lib/daydream/briefing.ts
//
// The Daydreams section of the morning briefing — ONE daily summary.
//
// There were two: the digest row (rich, deterministic, recomputed every six
// hours, seen by nobody who did not open Discoveries and scroll to E) and
// the briefing's own three facts (two titles and two counts, in WhatsApp
// only if the model chose to quote them). This is the one the briefing
// carries: what it said, what it held for you, what it caught, what it
// applied, what it learned — over the last LOCAL day, deterministic, every
// fact with a link into the hub.
//
// What it SAID is the think loop's notes from the last 24 hours (spec
// 2026-09-25, P2) — every note on the feed, raised or not, each linked to
// itself on the one feed page. Ponder's musings are no longer listed.

import { and, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '$lib/db';
import { daydreamCapabilities, daydreamLeads, daydreamMemoryThemes, daydreamPlaces, daydreamThoughts } from '$lib/db/schema';
import { localDayStart } from './budget';
import { errMsg } from './types';
import { digestDay, gatherStats, type DigestStats } from './digest/build';
import { loadFeedNotes } from './think/notes.server';
import type { FeedNote } from './think/notes';

export interface DaydreamBriefingFact {
  section: 'Daydreams';
  label: string;
  value: string;
  source: 'daydream';
  href: string | null;
}

export interface DaydreamBriefing {
  /** The local day the section describes, `YYYY-MM-DD`. */
  day: string;
  facts: DaydreamBriefingFact[];
  /** The WhatsApp block, ≤ 8 lines, verbatim into the message. */
  text: string;
  status: 'ok' | 'empty';
  /** The counts behind the lines, for the page. */
  counts: {
    sent: number;
    held: number;
    refuted: number;
    applied: number;
    placesNamed: number;
    expired: number;
    memoriesLearned: number;
    wants: number;
  };
  digest: DigestStats | null;
}

const FEED = '/jkai/daydreams/feed';
const APPETITE = '/jkai/daydreams/improvement#appetite';
const trim = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Notes listed as facts, each its own linked line. */
const NOTE_FACTS = 8;

/**
 * PURE. The think notes as briefing facts — one per note, each linked to
 * itself on the feed — and at most five WhatsApp lines.
 */
export function noticedSection(notes: Array<Pick<FeedNote, 'title' | 'url' | 'raised' | 'channelLabel' | 'outcomeLabel'>>): {
  facts: Array<{ label: string; value: string; href: string }>;
  lines: string[];
} {
  const facts = notes.slice(0, NOTE_FACTS).map((n) => ({
    label: n.raised ? 'Noticed, and told you' : 'Noticed, on the feed',
    value: `“${trim(n.title, 80)}” — ${n.channelLabel} · ${n.outcomeLabel}`,
    href: n.url,
  }));
  const lines = notes.slice(0, 4).map((n) => `• Noticed: ${trim(n.title, 70)}`);
  if (notes.length > 4) lines.push(`  …and ${notes.length - 4} more on the feed`);
  return { facts, lines };
}

/**
 * Assemble the section for the day that ENDED at the last local midnight —
 * the briefing goes at 07:00 and describes yesterday. Every read is bounded
 * and every failure of a bounded read leaves a line out rather than the
 * whole section.
 */
export async function buildDaydreamBriefing(now = new Date()): Promise<DaydreamBriefing> {
  const dayEnd = localDayStart(now);
  const dayStart = new Date(dayEnd.getTime() - 86_400_000);
  const day = digestDay(now, 1);
  const inDay = (col: AnyPgColumn) => and(gte(col, dayStart), lt(col, dayEnd));

  const [notes, refuted, applied, places, expired, themes, leads, wants, digest] = await Promise.all([
    // The last 24 hours, not the local day: the briefing lands at 07:00 and a
    // note written at 06:30 is news, not tomorrow's. Muted kinds and notes he
    // answered "never" stay out — he said he did not want to hear them.
    loadFeedNotes({ days: 1, now })
      .then((all) => all.filter((n) => !n.kindMuted && n.verdict !== 'never_kind'))
      .catch((err) => {
        console.warn(`[daydream] briefing notes read failed: ${errMsg(err)}`);
        return [] as FeedNote[];
      }),
    db
      .select({ id: daydreamThoughts.id, title: daydreamThoughts.title, why: daydreamThoughts.reviewReasoning })
      .from(daydreamThoughts)
      .where(and(eq(daydreamThoughts.reviewVerdict, 'refuted'), isNotNull(daydreamThoughts.reviewAt), inDay(daydreamThoughts.reviewAt)))
      .orderBy(desc(daydreamThoughts.reviewAt))
      .limit(4),
    db
      .select({ id: daydreamThoughts.id, title: daydreamThoughts.title })
      .from(daydreamThoughts)
      .where(and(eq(daydreamThoughts.suppressedReason, 'applied'), inDay(daydreamThoughts.updatedAt)))
      .limit(6),
    db
      .select({ id: daydreamPlaces.id, label: daydreamPlaces.label })
      .from(daydreamPlaces)
      .where(and(isNotNull(daydreamPlaces.label), eq(daydreamPlaces.source, 'confirmed'), inDay(daydreamPlaces.updatedAt)))
      .limit(6),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(daydreamThoughts)
      .where(and(eq(daydreamThoughts.status, 'expired'), inDay(daydreamThoughts.updatedAt))),
    db
      .select({ id: daydreamMemoryThemes.id, title: daydreamMemoryThemes.title })
      .from(daydreamMemoryThemes)
      .where(inDay(daydreamMemoryThemes.createdAt))
      .limit(5),
    db
      .select({
        opened: sql<number>`count(*) filter (where ${daydreamLeads.createdAt} >= ${dayStart} and ${daydreamLeads.createdAt} < ${dayEnd})::int`,
        open: sql<number>`count(*) filter (where ${daydreamLeads.status} = 'open')::int`,
      })
      .from(daydreamLeads),
    // What the engine would like to build, straight off the appetite ledger
    // rather than via the thought path. A capability lead is deliberately
    // low-scoring next to a health alarm, so it would sit below the cold-start
    // threshold for weeks and reach him never — and "here is what I think the
    // site is missing" is the one line of this section he asked for by name.
    db
      .select({ slug: daydreamCapabilities.slug, title: daydreamCapabilities.title, kind: daydreamCapabilities.kind })
      .from(daydreamCapabilities)
      .where(and(eq(daydreamCapabilities.status, 'proposed'), inDay(daydreamCapabilities.lastSeenAt)))
      .orderBy(desc(daydreamCapabilities.score))
      .limit(4)
      .catch((err) => {
        console.warn(`[daydream] briefing appetite read failed: ${errMsg(err)}`);
        return [] as Array<{ slug: string; title: string; kind: string }>;
      }),
    gatherStats(day).catch((err) => {
      console.warn(`[daydream] briefing digest stats failed: ${errMsg(err)}`);
      return null;
    }),
  ]);

  const facts: DaydreamBriefingFact[] = [];
  const lines: string[] = [];
  const fact = (label: string, value: string, href: string | null) => facts.push({ section: 'Daydreams', label, value, source: 'daydream', href });

  const noticed = noticedSection(notes);
  for (const f of noticed.facts) fact(f.label, f.value, f.href);
  lines.push(...noticed.lines);
  if (refuted.length) {
    fact(
      'Caught before sending',
      refuted.map((t) => `“${trim(t.title, 60)}” — ${trim((t.why ?? 'the sources disagreed').replace(/\s+/g, ' '), 100)}`).join(' · '),
      `${FEED}?s=held`,
    );
    lines.push(`• Caught ${refuted.length} false alarm${refuted.length === 1 ? '' : 's'} before sending`);
  }
  if (applied.length) {
    fact('Applied to the graph', applied.map((t) => `“${trim(t.title, 70)}”`).join(' · '), '/jkai/intel');
    lines.push(`• Applied ${applied.length} verified graph link${applied.length === 1 ? '' : 's'}`);
  }
  if (places.length) {
    fact('Places named', places.map((p) => p.label as string).join(' · '), '/jkai/daydreams/places');
    lines.push(`• Named: ${places.map((p) => p.label).join(', ')}`);
  }
  if (themes.length) {
    fact('Learned', themes.map((t) => trim(t.title, 60)).join(' · '), '/jkai/daydreams/memory');
    lines.push(`• Learned: ${themes.map((t) => trim(t.title, 50)).join('; ')}`);
  }
  if (wants.length) {
    fact(
      'Would like to build',
      wants.map((w) => `${trim(w.title, 60)} (${w.kind.replace(/_/g, ' ')})`).join(' · '),
      APPETITE,
    );
    lines.push(`• Would like to build: ${wants.slice(0, 2).map((w) => trim(w.title, 55)).join('; ')}`);
    if (wants.length > 2) lines.push(`  …and ${wants.length - 2} more on the appetite ledger`);
  }
  if (digest && (digest.questionsAsked || digest.questionsAnswered)) {
    const parts: string[] = [];
    if (digest.questionsAsked) parts.push(`asked ${digest.questionsAsked}`);
    if (digest.questionsAnswered) parts.push(`answered ${digest.questionsAnswered}${digest.held ? ` (${digest.held} holding)` : ''}`);
    fact('Questions', parts.join(', '), '/jkai/daydreams/discoveries');
    lines.push(`• Questions: ${parts.join(', ')}`);
  }
  const leadsOpened = leads[0]?.opened ?? 0;
  const leadsOpen = leads[0]?.open ?? 0;
  if (leadsOpened || leadsOpen) {
    fact('Lines of enquiry', `${leadsOpen} open${leadsOpened ? `, ${leadsOpened} opened yesterday` : ''}`, '/jkai/daydreams/discoveries');
  }
  const expiredN = expired[0]?.n ?? 0;
  if (expiredN) fact('Filed itself', `${expiredN} verified, unrated for a week`, `${FEED}?s=filed`);

  const counts = {
    sent: notes.filter((n) => n.raised).length,
    held: notes.filter((n) => !n.raised).length,
    refuted: refuted.length,
    applied: applied.length,
    placesNamed: places.length,
    expired: expiredN,
    memoriesLearned: themes.length,
    wants: wants.length,
  };
  const status: DaydreamBriefing['status'] = facts.length ? 'ok' : 'empty';
  if (status === 'empty') lines.push('• A quiet day — nothing said, nothing held, nothing caught.');

  return { day, facts, text: lines.slice(0, 8).join('\n'), status, counts, digest };
}
