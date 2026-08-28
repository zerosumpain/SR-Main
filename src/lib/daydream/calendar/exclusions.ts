// src/lib/daydream/calendar/exclusions.ts
//
// "Some of those calendar events are rolling reminders."
//
// That was the owner's note on a thought in August, and it is the whole reason
// this file exists. The diary is one of the strongest inputs daydreaming has —
// busy minutes feed the correlations, the week ahead feeds the ponder pack, an
// empty afternoon feeds a suggestion — and it is also the input most likely to
// be wrong ABOUT HIM rather than wrong in itself. A standing reminder that has
// sat in the calendar for two years is a real event and a fictional
// commitment, and no amount of parsing separates the two. Only he can.
//
// So: a filter he owns, applied to what the engine reads. Nothing here touches
// iCloud, and removing a row restores the event everywhere at once.
//
// ── Why three scopes ────────────────────────────────────────────────────────
//
// "Ignore that" means three different things, and collapsing them would make
// the control either useless or dangerous:
//
//   series      every occurrence sharing an iCalendar UID. A recurring event
//               is ONE object with an RRULE, expanded into occurrences at read
//               time, so they all carry the same UID. This is the rolling
//               reminder case and the common one.
//   occurrence  one dated instance. "Not this week" — the series stays.
//   title       anything called this, whatever its UID. Some calendars
//               recreate an entry from scratch each time, giving it a fresh
//               UID on every occurrence, and those cannot be caught by series.
//
// EVERYTHING HERE IS PURE. The matcher decides what the engine is blind to,
// which makes it exactly the thing that must be testable without a database.

/** What the matcher needs to know about one calendar occurrence. */
export interface ExcludableEvent {
  /** The iCalendar UID. Absent on a malformed entry, which is why title scope
   *  exists at all as a fallback. */
  uid?: string | null;
  title?: string | null;
  /** The occurrence's own start. */
  start: Date | string;
}

export type ExclusionScope = 'series' | 'occurrence' | 'title';

/** An exclusion as the matcher sees it — the stored row, minus the display
 *  fields that never take part in a decision. */
export interface ExclusionRule {
  scope: ExclusionScope;
  uid?: string | null;
  occurrenceStart?: Date | string | null;
  titleKey?: string | null;
}

/**
 * Case- and whitespace-normalised title.
 *
 * Deliberately mild: lowercase, collapse runs of whitespace, trim. It does NOT
 * strip punctuation or emoji, because "Bins 🗑" and "Bins" are plausibly two
 * different entries and silently merging them would hide an event the owner
 * never asked to hide. Over-matching here is the expensive direction — it
 * makes the engine blind to something real.
 */
export function titleKeyOf(title: string | null | undefined): string {
  return (title ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Minute resolution for occurrence matching. iCloud re-serialises timestamps
 *  and re-expands recurrences, so seconds and milliseconds drift between reads
 *  of the same event; the minute does not. */
export function minuteKey(at: Date | string): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 16);
}

/**
 * The single value stored and compared.
 *
 * Derived rather than computed at query time so "is this already excluded?" is
 * one indexed lookup, and so a unique index can stop the same rule being added
 * twice. Returns null when the rule cannot be expressed — a series rule with
 * no UID would otherwise be a row that matches everything or nothing depending
 * on how the comparison was written, and both are worse than a refusal.
 */
export function exclusionKey(rule: ExclusionRule): string | null {
  switch (rule.scope) {
    case 'series':
      return rule.uid ? `series:${rule.uid}` : null;
    case 'occurrence': {
      if (!rule.uid || !rule.occurrenceStart) return null;
      const m = minuteKey(rule.occurrenceStart);
      return m ? `occurrence:${rule.uid}:${m}` : null;
    }
    case 'title': {
      const key = titleKeyOf(rule.titleKey);
      return key ? `title:${key}` : null;
    }
    default:
      return null;
  }
}

/** Every key an event would be hidden by. Cheap set membership at the call
 *  site, rather than a scan over the rules per event. */
export function eventKeys(ev: ExcludableEvent): string[] {
  const keys: string[] = [];
  if (ev.uid) {
    keys.push(`series:${ev.uid}`);
    const m = minuteKey(ev.start);
    if (m) keys.push(`occurrence:${ev.uid}:${m}`);
  }
  const t = titleKeyOf(ev.title);
  if (t) keys.push(`title:${t}`);
  return keys;
}

/**
 * A matcher over a set of stored keys.
 *
 * Built once per read and reused across every event, so applying exclusions to
 * a 250-event month is set lookups rather than a nested loop.
 */
export class ExclusionSet {
  private readonly keys: Set<string>;

  constructor(keys: Iterable<string>) {
    this.keys = new Set(keys);
  }

  /** Built from stored rows. Rows whose key cannot be derived are dropped
   *  rather than silently matching. */
  static fromRules(rules: ExclusionRule[]): ExclusionSet {
    return new ExclusionSet(
      rules.map(exclusionKey).filter((k): k is string => k !== null),
    );
  }

  get size(): number {
    return this.keys.size;
  }

  /** Which rule key hid this event, or null. Returning the key rather than a
   *  boolean lets the calendar tab say WHY something is hidden and offer the
   *  right thing to undo. */
  reasonFor(ev: ExcludableEvent): string | null {
    if (this.keys.size === 0) return null;
    for (const k of eventKeys(ev)) if (this.keys.has(k)) return k;
    return null;
  }

  excludes(ev: ExcludableEvent): boolean {
    return this.reasonFor(ev) !== null;
  }

  /** Split a list into what the engine may see and what it may not. Returning
   *  both halves is the point: the count of what was hidden goes on the page,
   *  so a filtered diary never passes for an empty one. */
  partition<T extends ExcludableEvent>(events: T[]): { kept: T[]; hidden: T[] } {
    const kept: T[] = [];
    const hidden: T[] = [];
    for (const e of events) (this.excludes(e) ? hidden : kept).push(e);
    return { kept, hidden };
  }
}

/** The empty matcher — hides nothing. Used wherever a read fails, so a broken
 *  exclusions query can never accidentally blind the engine to the whole
 *  diary. Failing open is right here: the failure mode of failing closed is an
 *  engine that silently believes you have no commitments at all. */
export const NO_EXCLUSIONS = new ExclusionSet([]);
