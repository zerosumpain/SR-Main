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
import type { Candidate } from '../candidate';
import { OUTCOMES, type Channel, type Outcome } from './questions';
import type { Card } from './tools';

export const MAX_NOTES = 2;
export const MAX_TITLE_CHARS = 90;
export const MAX_BODY_CHARS = 700;
export const MAX_ACTION_CHARS = 200;

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
  citedCardIds: string[];
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
  opts: { maxNotes?: number; allowedOutcomes?: readonly Outcome[]; channel?: Channel } = {},
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
    const label = title.slice(0, 40) || '(untitled)';

    if (!allowed.has(outcome)) { out.rejected.push(`note "${label}": outcome "${outcome}" not allowed this cycle`); continue; }
    if (title.length < 3 || title.length > MAX_TITLE_CHARS) { out.rejected.push(`note "${label}": bad title`); continue; }
    if (body.length < 20 || body.length > MAX_BODY_CHARS) { out.rejected.push(`note "${label}": body length ${body.length}`); continue; }
    if (action && action.length > MAX_ACTION_CHARS) { out.rejected.push(`note "${label}": action too long`); continue; }

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
    const slug = slugOf(title);
    if (slug.length < 3) { out.rejected.push(`note "${label}": title has no usable words`); continue; }

    out.notes.push({
      outcome: outcome as Outcome,
      title,
      body,
      action,
      citedCardIds: resolved.hits,
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
        ],
        dedupeKey: `think:${outcome}:${slug}`,
        proposedActions: [],
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
