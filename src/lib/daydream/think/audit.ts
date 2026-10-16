// src/lib/daydream/think/audit.ts
//
// What a think cycle may return, and what survives. PURE — no db, no model.
//
// The contract is ponder's, moved: every note cites card ids, and a note citing
// a card that was never issued dies WHOLE — not repaired, not trimmed to its
// valid citations. The count of those deaths is the fabrication meter and is
// always reported. Citations are read with `resolveCites`, the one rule every
// audit here shares, so a model that echoes "[C3]" as rendered has cited C3.

import { resolveCites } from '../cites';
import { checkPlan, storeAction, type StoredAction } from '../act/plan';
import type { Candidate } from '../snapshot-types';
import { OUTCOMES, type Channel, type Outcome } from './questions';
import { parseUntil } from './shelf';
import { SUBJECT_EVIDENCE_KIND, subjectFor } from './subjects';
import type { Card } from './tools';

export const MAX_NOTES = 2;
export const MAX_TITLE_CHARS = 90;
export const MAX_BODY_CHARS = 700;
export const MAX_ACTION_CHARS = 200;
export const MAX_CHANGED_CHARS = 200;

/**
 * The evidence kind that records which QUESTION a note answered.
 *
 * A note's outcome is its kind (`think_<outcome>`), but the channel the cycle
 * started from was recorded nowhere — and the phone draws a glyph by it, the
 * Health tab filters on it, and the 30-day measure of the programme ("no
 * channel over 30%") is counted in it. It rides in the evidence list because
 * that is the typed-reference column the row already has; `refutations.ts`
 * lists it as a kind that identifies nothing, so two notes that share only a
 * channel are never taken for the same claim.
 */
export const QUESTION_EVIDENCE_KIND = 'think-question';

export interface ThinkNote {
  outcome: Outcome;
  title: string;
  body: string;
  action: string | null;
  /** The last day it is likely to matter, by the model's own estimate
   *  (`YYYY-MM-DD`), or null. A bad date is dropped, never repaired. */
  until: string | null;
  citedCardIds: string[];
  /** What it is about (`subjects.ts`), or null when nothing checkable names it. */
  subject: string | null;
  /** The model's "what changed since the earlier note", verbatim, or null. */
  changed: string | null;
  /** The cited cards' text, joined — what a changed figure must appear in. */
  citedText: string;
  candidate: Candidate;
}

export interface ThinkAudit {
  notes: ThinkNote[];
  /** One line per refusal. The fabrication meter — report it, always. */
  rejected: string[];
  /** How many notes died for citing a card that was never issued. Counted
   *  apart from the other refusals because it is the number that says the
   *  model made something up. */
  citationDrops: number;
}

/** Lowercase, hyphenated, bounded — the title's share of the dedupe key. */
export function slugOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function validateThinkOutput(
  parsed: unknown,
  cards: ReadonlyMap<string, Card>,
  opts: {
    maxNotes?: number;
    allowedOutcomes?: readonly Outcome[];
    channel?: Channel;
    today?: string;
    /** Cards of pairs tested recently with nothing new (`ledger.ts`). */
    staleCards?: ReadonlySet<string>;
    /** A research cycle's one interest, set by code (`interests.ts`). */
    researchTopic?: string | null;
    /** The monthly correlation summary's subject, set by code (`ledger.ts`). */
    summaryKey?: string | null;
  } = {},
): ThinkAudit {
  const out: ThinkAudit = { notes: [], rejected: [], citationDrops: 0 };
  const maxNotes = opts.maxNotes ?? MAX_NOTES;
  const allowed = new Set<string>(opts.allowedOutcomes ?? OUTCOMES);
  if (parsed == null || typeof parsed !== 'object') {
    out.rejected.push('output is not an object');
    return out;
  }
  const raw = (parsed as { notes?: unknown }).notes;
  const notes = Array.isArray(raw) ? raw : [];

  for (const item of notes) {
    if (out.notes.length >= maxNotes) {
      out.rejected.push('note over the per-cycle cap');
      continue;
    }
    const n = (item ?? {}) as Record<string, unknown>;
    const outcome = typeof n.outcome === 'string' ? n.outcome.trim() : '';
    const title = typeof n.title === 'string' ? n.title.trim() : '';
    const body = typeof n.body === 'string' ? n.body.trim() : '';
    const action = typeof n.action === 'string' && n.action.trim() ? n.action.trim() : null;
    const changed = typeof n.changed === 'string' && n.changed.trim() ? n.changed.trim().slice(0, MAX_CHANGED_CHARS) : null;
    const label = title.slice(0, 40) || '(untitled)';

    if (!allowed.has(outcome)) { out.rejected.push(`note "${label}": outcome "${outcome}" not allowed this cycle`); continue; }
    if (title.length < 3 || title.length > MAX_TITLE_CHARS) { out.rejected.push(`note "${label}": bad title`); continue; }
    if (body.length < 20 || body.length > MAX_BODY_CHARS) { out.rejected.push(`note "${label}": body length ${body.length}`); continue; }
    if (action && action.length > MAX_ACTION_CHARS) { out.rejected.push(`note "${label}": action too long`); continue; }
    // The "so what" gate: a research find he could do nothing with this
    // fortnight is reading for its own sake — 2 of 71 were rated useful.
    if (opts.researchTopic && !action) { out.rejected.push(`note "${label}": research with no use for him — dropped`); continue; }

    const resolved = resolveCites(n.cites, cards);
    if (resolved.misses.length) {
      // The audit. Citing a card that was never issued is the model telling us
      // it made something up; the note dies whole.
      out.citationDrops++;
      out.rejected.push(`note "${label}": cites unissued cards ${resolved.misses.join(',')} — dropped`);
      continue;
    }
    if (resolved.hits.length === 0) {
      out.citationDrops++;
      out.rejected.push(`note "${label}": no citations — dropped`);
      continue;
    }

    const cited = resolved.hits.map((id) => cards.get(id)!);
    // A correlate note resting only on pairs already tested with nothing new
    // since repeats the earlier note (`ledger.ts`). The summary is exempt: the
    // ledger is its material.
    if (outcome === 'correlate' && !opts.summaryKey && opts.staleCards?.size) {
      const tests = cited.filter((c) => c.tool === 'correlate');
      if (tests.length && tests.every((c) => opts.staleCards!.has(c.id))) {
        out.rejected.push(`note "${label}": every pair it cites was already tested with nothing new — dropped`);
        continue;
      }
    }
    // "Do it for me", ready before he taps (`act/plan.ts`). A plan that fails
    // its checks is dropped — the note still stands.
    let proposedActions: StoredAction[] = [];
    if (n.do && opts.today) {
      const checked = checkPlan(n.do, {
        noteText: `${title}\n${body}\n${action ?? ''}`,
        today: opts.today,
        evidenceText: cited.map((c) => c.text).join('\n'),
      });
      if (checked.ok) proposedActions = [storeAction(checked.plan, null)];
      else out.rejected.push(`note "${label}": do-it plan dropped — ${checked.reason}`);
    }
    const slug = slugOf(title);
    if (slug.length < 3) { out.rejected.push(`note "${label}": title has no usable words`); continue; }

    const subject = subjectFor({
      outcome,
      modelSubject: n.subject,
      cited,
      researchTopic: opts.researchTopic,
      summaryKey: opts.summaryKey,
    });

    out.notes.push({
      outcome: outcome as Outcome,
      title,
      body,
      action,
      until: opts.today ? parseUntil(n.until, opts.today) : null,
      citedCardIds: resolved.hits,
      subject,
      changed,
      citedText: cited.map((c) => c.text).join('\n'),
      candidate: {
        kind: `think_${outcome}`,
        title,
        // Deterministic and code-built — what was read, not what was said.
        explanation:
          `Read ${cited.length} card${cited.length === 1 ? '' : 's'}: ` +
          cited.map((c) => `${c.tool}(${JSON.stringify(c.args)})`).join(' · ').slice(0, 600),
        // An audited note that survived its own cycle. The learned kind weight
        // is what moves this down, per outcome, as he rates them.
        rawScore: 1,
        components: { audited: 1 },
        evidence: [
          ...cited.map((c) => ({ kind: 'think-card', id: c.ref, note: c.text.slice(0, 300) })),
          ...(opts.channel
            ? [{ kind: QUESTION_EVIDENCE_KIND, id: opts.channel, note: `${opts.channel} × ${outcome}` }]
            : []),
          ...(subject ? [{ kind: SUBJECT_EVIDENCE_KIND, id: subject, note: changed ? `changed: ${changed}` : 'subject' }] : []),
        ],
        dedupeKey: `think:${outcome}:${slug}`,
        proposedActions,
      },
    });
  }
  return out;
}

/** Pull the JSON object out of a reply, tolerating a fenced block. */
export function parseReply(raw: string): unknown {
  const body = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(body);
  } catch {
    // A model that wrote a sentence before its JSON. Take the outermost object.
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
