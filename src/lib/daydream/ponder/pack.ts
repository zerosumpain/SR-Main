// src/lib/daydream/ponder/pack.ts
//
// The fact pack: everything the ponder model may reason over, as numbered
// cards. This is the load-bearing surface of the whole second-brain design —
// the model gets a WIDE view (family, diary, money, health, graph, memories,
// its own track record) but every card carries an id, and downstream nothing
// the model says survives unless it cites cards that exist. The fabrication
// defence moved from starving the model to auditing it; the audit needs
// something to audit against, and this is it.
//
// Coordinate-free by construction, like every other prompt surface here: a
// card may say "home", "Jemima's usual Tuesday place", "4.2 km from home" —
// never a lat/lon, never a raw email body, never a phone number.
//
// ASSEMBLY IS PURE. The queries live in run.ts (and the lookup stage in
// lookups.ts);
// assemblePack() takes plain data so the card layout — the part that decides
// what the model can and cannot see — is unit-testable with no database.

import type { DaydreamSnapshot } from '../snapshot-types';

export interface FactCard {
  /** 'F1'.. — the citation handle, stable only within one pack. */
  id: string;
  /** Where a citation of this card points back to. */
  ref: { kind: string; id: string };
  /** 'past' | 'present' | 'upcoming' */
  tense: string;
  text: string;
}

export interface FactPack {
  cards: FactCard[];
  byId: Map<string, FactCard>;
}

export interface PackInputs {
  snapshot: DaydreamSnapshot;
  /** Recent hypothesis verdicts, the engine's own discoveries + refutations. */
  verdicts: Array<{ id: string; question: string; verdict: string; summary: string | null }>;
  /** Aggregates over the day-feature store, precomputed by the caller. */
  aggregates: Array<{ key: string; text: string }>;
  /** The 7-day diary, fetched separately from the snapshot's 1-day view. */
  weekAhead: Array<{ title: string; whenText: string; location: string | null }>;
  /** How the owner has responded to past thoughts, per kind. */
  feedbackLines: string[];
  /** Distilled behaviour profile lines (deterministic, see profile.ts). */
  profileLines: string[];
  /**
   * Cards fetched by the lookup stage — code saw a gap, called a read-only
   * first-party tool and turned the answer into facts. Optional so every
   * existing caller and fixture still type-checks; absent means the stage did
   * not run, which is what a thin or budgetless cycle looks like.
   */
  lookups?: Array<{ ref: { kind: string; id: string }; text: string }>;
}

/** Card budget. A pack over ~90 cards stops being context and starts being a
 *  haystack; the caps below decide who loses seats, not the model. */
export const PACK_LIMITS = {
  places: 10,
  memories: 16,
  upcomingEmail: 12,
  recentEmail: 6,
  spendRows: 10,
  offers: 6,
  verdicts: 8,
  weekAhead: 12,
  interests: 8,
  lookups: 12,
} as const;

function pounds(minor: number): string {
  return `£${(minor / 100).toFixed(2)}`;
}

/**
 * Lay the cards. Order is deliberate: present first (what is happening now is
 * the trigger surface), then upcoming (what a useful thought is early FOR),
 * then past (the context that makes a crossing worth pointing out).
 */
export function assemblePack(inputs: PackInputs): FactPack {
  const { snapshot: s } = inputs;
  const cards: FactCard[] = [];
  const add = (tense: string, ref: { kind: string; id: string }, text: string) => {
    const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, 220);
    if (!trimmed) return;
    cards.push({ id: `F${cards.length + 1}`, ref, tense, text: trimmed });
  };

  // ── Present ──
  const placeName = (id: string | null) =>
    id ? (s.places.find((p) => p.id === id)?.label ?? null) : null;

  if (s.current) {
    const at = placeName(s.current.placeId);
    add('present', { kind: 'trail', id: 'current' },
      `John is ${s.current.isHome ? 'at home' : at ? `at ${at}` : 'out'}` +
      `${s.current.mode !== 'still' && s.current.mode !== 'unknown' ? `, moving (${s.current.mode})` : ''}` +
      ` — position ${s.current.ageMins} min old.`);
  }
  if (s.family.available) {
    for (const m of s.family.members) {
      if (m.lastSeenAt == null) {
        add('present', { kind: 'family', id: m.subject }, `${cap(m.subject)}: not tracked right now.`);
        continue;
      }
      const stale = m.ageMins != null && m.ageMins > 60 ? ` (last seen ${m.ageMins} min ago)` : '';
      add('present', { kind: 'family', id: m.subject },
        `${cap(m.subject)} is ${m.isHome ? 'at home' : m.placeLabel ? `at ${m.placeLabel}` : m.distanceHomeKm != null ? `out, ${m.distanceHomeKm} km from home` : 'out'}${stale}.`);
    }
  }
  if (s.health.readiness) {
    add('present', { kind: 'health', id: 'readiness' },
      `Readiness ${s.health.readiness.score} (${s.health.readiness.label}).`);
  }
  if (s.health.lastNightSleep) {
    const base = s.health.sleepBaseline != null ? ` vs his own baseline ${Math.round(s.health.sleepBaseline)}` : '';
    add('present', { kind: 'health', id: 'sleep' },
      `Last night's sleep: ${s.health.lastNightSleep.performance}%${base}, ${Math.round(s.health.lastNightSleep.durationMins / 60 * 10) / 10}h.`);
  }
  if (s.health.daysSinceWorkout != null) {
    add('present', { kind: 'health', id: 'workout' }, `${s.health.daysSinceWorkout} days since the last workout.`);
  }
  if (s.calendar.available) {
    const today = s.calendar.events.slice(0, 6);
    if (today.length === 0 && !s.calendar.partial) {
      add('present', { kind: 'calendar', id: 'today' }, 'Nothing on the calendar today or tomorrow.');
    }
    for (const e of today) {
      add('present', { kind: 'calendar', id: 'today' },
        `Diary: ${e.title} at ${e.start.toISOString().slice(11, 16)}Z${e.location ? `, ${e.location}` : ''}.`);
    }
    if (s.calendar.partial) {
      add('present', { kind: 'calendar', id: 'today' },
        'CAUTION: at least one calendar could not be read — the diary above may be missing entries.');
    }
  }

  // ── Upcoming ──
  for (const e of inputs.weekAhead.slice(0, PACK_LIMITS.weekAhead)) {
    add('upcoming', { kind: 'calendar', id: 'week' },
      `Coming up: ${e.title} ${e.whenText}${e.location ? `, ${e.location}` : ''}.`);
  }
  if (s.emailFacts.available) {
    for (const f of s.emailFacts.upcoming.slice(0, PACK_LIMITS.upcomingEmail)) {
      add('upcoming', { kind: 'email', id: f.noteId }, `From email: ${f.type} — ${f.title} on ${f.date}.`);
    }
  }
  if (s.offers.available) {
    for (const o of s.offers.items.slice(0, PACK_LIMITS.offers)) {
      add('upcoming', { kind: 'email', id: o.emailId },
        `Offer: ${o.merchant} — ${o.summary}${o.expiresAt ? `, expires ${o.expiresAt.toISOString().slice(0, 10)}` : ''}.`);
    }
  }

  // ── Past ──
  if (s.spend.available) {
    add('past', { kind: 'spend', id: 'total' },
      `Evidenced spend last 30 days: ${pounds(s.spend.totalMinor30d)} (receipts/bank only — understates cash).`);
    for (const r of s.spend.recent.slice(0, PACK_LIMITS.spendRows)) {
      add('past', { kind: 'spend', id: r.id }, `Paid ${pounds(r.amountMinor)} to ${r.merchant} on ${r.day}.`);
    }
  }
  if (s.emailFacts.available) {
    for (const f of s.emailFacts.recent.slice(0, PACK_LIMITS.recentEmail)) {
      add('past', { kind: 'email', id: f.noteId }, `Recently from email: ${f.type} — ${f.title} on ${f.date}.`);
    }
  }
  const namedPlaces = s.places
    .filter((p) => p.label && p.status === 'active')
    .sort((a, b) => b.visitCount - a.visitCount)
    .slice(0, PACK_LIMITS.places);
  for (const p of namedPlaces) {
    add('past', { kind: 'place', id: p.id },
      `${p.label} (${p.kind}): ${p.visitCount} household visits, median stay ${p.medianDwellMins} min.`);
  }
  for (const v of inputs.verdicts.slice(0, PACK_LIMITS.verdicts)) {
    add('past', { kind: 'hypothesis', id: v.id },
      `Tested: "${v.question}" → ${v.verdict}${v.summary ? ` (${v.summary})` : ''}.`);
  }
  for (const a of inputs.aggregates) {
    add('past', { kind: 'features', id: a.key }, a.text);
  }
  const memories = s.memories.slice(0, PACK_LIMITS.memories);
  for (const m of memories) {
    add('past', { kind: 'memory', id: m.id }, `Known (${m.category}): ${m.content}`);
  }
  for (const t of s.interests.slice(0, PACK_LIMITS.interests)) {
    add('past', { kind: 'interest', id: t.refId }, `Recent interest (${t.source}): ${t.term}`);
  }
  // Looked-up facts last: they are context for what is already on the table,
  // and a card's position is the only ordering signal the model gets. Their
  // refs are ordinary evidence kinds, so a musing citing one drills through
  // exactly like a musing citing a memory the snapshot supplied.
  for (const l of (inputs.lookups ?? []).slice(0, PACK_LIMITS.lookups)) {
    add('past', l.ref, l.text);
  }

  return { cards, byId: new Map(cards.map((c) => [c.id, c])) };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Render for the prompt: grouped by tense, one line per card. */
export function renderPack(pack: FactPack): string {
  const group = (tense: string, title: string) => {
    const rows = pack.cards.filter((c) => c.tense === tense);
    if (rows.length === 0) return '';
    return `${title}\n${rows.map((c) => `${c.id}. ${c.text}`).join('\n')}\n`;
  };
  return [
    group('present', '── NOW ──'),
    group('upcoming', '── COMING UP ──'),
    group('past', '── KNOWN / RECENT ──'),
  ].filter(Boolean).join('\n');
}
