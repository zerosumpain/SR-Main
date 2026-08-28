// src/lib/daydream/mail/scan.ts
//
// From classified mail to daydream candidates.
//
// Two things happen here that a per-message classifier cannot do on its own:
//
// 1. NOVELTY. "Unusual for you" is not a vocabulary; it is a fact about the
//    corpus. A sender writing for the first time, or a familiar sender sending
//    a KIND of mail it has never sent before, is the signal — and both are
//    cheap SQL, not a model call.
//
// 2. CLUSTERING. On 2026-08-27 production received six account-security mails
//    from four senders inside one day. Six thoughts would have eaten a day and
//    a half of the interruption budget saying one thing. One thought that says
//    "six of these, from four senders, in a day" is both more useful and
//    cheaper, and it is the reason security mail can be allowed to push at all
//    without raising MAX_PER_DAY.
//
// The assembly is PURE — `buildMailCandidates` takes plain rows and returns
// candidates — so the burst arithmetic, which is the part that decides how
// often a phone rings, is testable with no database.

import type { Candidate } from '../snapshot-types';
import { classifyMail, senderBrand, type MailCategory } from './classify';

/** One email as the scanner reads it. */
export interface MailRow {
  noteId: string;
  subject: string;
  senderDomain: string | null;
  emailKind: string | null;
  observedAt: Date;
}

/** What the corpus already knew about a sender, before this window. */
export interface SenderHistory {
  /** Domains seen at all before the window opened. */
  known: Set<string>;
  /** domain -> the categories that domain has previously been filed under. */
  categoriesSeen: Map<string, Set<string>>;
}

export interface MailHit {
  row: MailRow;
  category: MailCategory;
  score: number;
  matched: string[];
  /** Why this counts as unusual, or null when it is simply a known sender
   *  doing a known thing. */
  novelty: 'new_sender' | 'new_category_for_sender' | null;
}

/** Mail older than this is history, not news. Matches the offer scanner's
 *  horizon so the two readers see the same window of the mailbox. */
export const MAIL_SCAN_DAYS = 14;

/** How wide a burst is. Long enough to gather a campaign that runs overnight,
 *  short enough that two unrelated incidents a week apart stay two thoughts. */
export const BURST_WINDOW_HOURS = 48;

/** A burst needs this many mails AND this many distinct senders. One sender
 *  retrying four times is a retry, not a pattern — SecondSim sent the same
 *  payment-failure notice on four days in August. */
export const BURST_MIN_MAILS = 3;
export const BURST_MIN_SENDERS = 2;

/**
 * How recent a group's newest message must be for it to become a candidate.
 *
 * The scan reads a fortnight so a burst has the context to be recognised as
 * one, but an account-security alert surfaced twelve days late is not an
 * alert — it is a history lesson, and pushing it would spend an interruption
 * on something that can no longer be acted on. So the window the scanner READS
 * and the window it SPEAKS about are deliberately different sizes.
 */
export const CANDIDATE_MAX_AGE_DAYS = 4;

/**
 * Decide novelty for one row against what the corpus knew beforehand.
 *
 * Bulk mail is excluded from `new_sender` outright: new marketing domains
 * appear constantly and none of them is interesting. A first-time
 * CORRESPONDENT is a different matter.
 */
export function noveltyOf(
  row: MailRow,
  category: MailCategory,
  history: SenderHistory,
): MailHit['novelty'] {
  const domain = (row.senderDomain ?? '').toLowerCase();
  if (!domain) return null;
  const isBulk = row.emailKind === 'bulk';
  if (!history.known.has(domain)) return isBulk ? null : 'new_sender';
  const seen = history.categoriesSeen.get(domain);
  if (seen && !seen.has(category)) return 'new_category_for_sender';
  return null;
}

/** Ceilings. A rule over a subject line is never certainty, and a cluster of
 *  them must always be able to outrank the best single member. */
export const SINGLE_MAIL_CEILING = 0.9;
export const BURST_CEILING = 0.97;

/** Classifier score → the 0..1 `rawScore` the ledger expects. A floor-clearing
 *  hit starts around 0.6 and a very strong one approaches the ceiling. */
export function rawScoreFor(score: number, novelty: MailHit['novelty']): number {
  const base = Math.min(0.85, 0.45 + score * 0.04);
  // The single-mail ceiling sits BELOW the burst ceiling on purpose. When both
  // capped at the same number a six-sender cluster scored identically to one
  // strong message, and the coincidence — the whole reason clustering exists —
  // stopped being visible in the ranking.
  return Math.min(SINGLE_MAIL_CEILING, base + (novelty ? 0.05 : 0));
}

function titleCase(c: MailCategory): string {
  return c === 'money_admin' ? 'money' : c === 'official' ? 'official post' : c;
}

/** A person-readable sender name, falling back to the raw domain. */
function who(row: MailRow): string {
  return senderBrand(row.senderDomain) ?? row.senderDomain ?? 'an unidentified sender';
}

/**
 * Group hits into bursts.
 *
 * Greedy over time within a category: open a group at the first hit, keep
 * adding while the next hit is inside BURST_WINDOW_HOURS of the group's FIRST
 * member (not its last — otherwise a steady trickle chains into one endless
 * "burst" that never closes).
 */
export function groupBursts(hits: MailHit[]): MailHit[][] {
  const byCategory = new Map<MailCategory, MailHit[]>();
  for (const h of hits) {
    const list = byCategory.get(h.category) ?? [];
    list.push(h);
    byCategory.set(h.category, list);
  }

  const groups: MailHit[][] = [];
  for (const list of byCategory.values()) {
    const sorted = list.slice().sort((a, b) => a.row.observedAt.getTime() - b.row.observedAt.getTime());
    let group: MailHit[] = [];
    let anchor = 0;
    for (const h of sorted) {
      const t = h.row.observedAt.getTime();
      if (group.length === 0) {
        group = [h];
        anchor = t;
        continue;
      }
      if (t - anchor <= BURST_WINDOW_HOURS * 3_600_000) {
        group.push(h);
      } else {
        groups.push(group);
        group = [h];
        anchor = t;
      }
    }
    if (group.length) groups.push(group);
  }
  return groups;
}

function isBurst(group: MailHit[]): boolean {
  if (group.length < BURST_MIN_MAILS) return false;
  const senders = new Set(group.map((h) => (h.row.senderDomain ?? h.row.noteId).toLowerCase()));
  return senders.size >= BURST_MIN_SENDERS;
}

/** A stable day key for a burst's anchor, so a burst that grows updates the
 *  standing thought rather than spawning a sibling every scan. */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Turn classified hits into candidates.
 *
 * PURE. Everything about how loud this lane is — how many thoughts a day of
 * security mail produces — is decided in this function and nowhere else.
 */
export function buildMailCandidates(
  hits: MailHit[],
  opts: { now?: Date; maxAgeDays?: number } = {},
): Candidate[] {
  const out: Candidate[] = [];
  const now = opts.now ?? new Date();
  const maxAgeMs = (opts.maxAgeDays ?? CANDIDATE_MAX_AGE_DAYS) * 86_400_000;

  for (const group of groupBursts(hits)) {
    const category = group[0].category;
    const kind = `mail_${category}`;

    // Judged on the group's NEWEST member: a burst that started a week ago and
    // is still arriving is live news, while one that ended a week ago is not.
    const newest = Math.max(...group.map((h) => h.row.observedAt.getTime()));
    if (now.getTime() - newest > maxAgeMs) continue;

    if (isBurst(group)) {
      const senders = [...new Set(group.map((h) => who(h.row)))];
      const first = group[0].row.observedAt;
      const last = group[group.length - 1].row.observedAt;
      const hours = Math.max(1, Math.round((last.getTime() - first.getTime()) / 3_600_000));
      const best = group.slice().sort((a, b) => b.score - a.score)[0];

      out.push({
        kind,
        title:
          category === 'security'
            ? `${group.length} account-security emails from ${senders.length} senders in ${hours}h`
            : `${group.length} ${titleCase(category)} emails from ${senders.length} senders in ${hours}h`,
        // Rule-generated and complete on its own: if the composer never ran,
        // this sentence would still say what happened and why it was noticed.
        explanation:
          `Between ${dayKey(first)} and ${dayKey(last)}, ${group.length} emails matched the ` +
          `${titleCase(category)} rules from ${senders.length} different senders ` +
          `(${senders.slice(0, 5).join(', ')}). ` +
          `The strongest was "${best.row.subject}" from ${who(best.row)}, matching ${best.matched.join(', ')}. ` +
          `A single one of these is routine; several from unrelated senders at once is not.`,
        // A cluster is worth more than its best member: the coincidence is the
        // finding. Capped so it can never outrank a stated emergency.
        rawScore: Math.min(BURST_CEILING, rawScoreFor(best.score, best.novelty) + 0.1),
        components: {
          mails: group.length,
          senders: senders.length,
          hours,
          topSignalScore: best.score,
          burst: 1,
        },
        evidence: group.map((h) => ({
          kind: 'email',
          id: h.row.noteId,
          note: `${dayKey(h.row.observedAt)} · ${who(h.row)} · ${h.row.subject}`.slice(0, 500),
        })),
        dedupeKey: `mail:burst:${category}:${dayKey(first)}`,
        proposedActions: [],
      });
      continue;
    }

    // Not a burst — each mail stands on its own.
    for (const h of group) {
      const noveltyLine =
        h.novelty === 'new_sender'
          ? ` This is the first email this address has ever had from ${who(h.row)}.`
          : h.novelty === 'new_category_for_sender'
            ? ` ${who(h.row)} has written before, but never about this.`
            : '';

      out.push({
        kind,
        title: h.row.subject.slice(0, 200),
        explanation:
          `${who(h.row)} sent this on ${dayKey(h.row.observedAt)}. ` +
          `It matched the ${titleCase(h.category)} rules on ${h.matched.join(', ')}.` +
          noveltyLine,
        rawScore: rawScoreFor(h.score, h.novelty),
        components: {
          signalScore: h.score,
          ...(h.novelty ? { novelty: 1 } : {}),
        },
        evidence: [
          {
            kind: 'email',
            id: h.row.noteId,
            note: `${dayKey(h.row.observedAt)} · ${who(h.row)} · ${h.row.subject}`.slice(0, 500),
          },
        ],
        dedupeKey: `mail:${h.row.noteId}`,
        proposedActions: [],
      });
    }
  }

  return out.sort((a, b) => b.rawScore - a.rawScore);
}

/** Classify a batch against sender history. PURE. */
export function findMailHits(rows: MailRow[], history: SenderHistory): MailHit[] {
  const hits: MailHit[] = [];
  for (const row of rows) {
    const c = classifyMail({
      subject: row.subject,
      senderDomain: row.senderDomain,
      emailKind: row.emailKind,
    });
    if (!c.category) continue;
    hits.push({
      row,
      category: c.category,
      score: c.score,
      matched: c.matched,
      novelty: noveltyOf(row, c.category, history),
    });
  }
  return hits;
}
